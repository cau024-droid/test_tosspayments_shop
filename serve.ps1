# Local test server (PowerShell only, no install needed)
#   - Serves the static shop pages
#   - POST /api/orders   : calculates the amount on the server and saves the order as PENDING
#   - POST /api/confirm  : checks the amount and calls the Toss Payments confirm API with the secret key
#   - POST /api/fail     : records why a payment did not complete (FAILED / USER_CANCELED)
#   - GET  /api/orders   : lists saved orders (for testing)
#
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1  ->  http://localhost:8080
#        Use your own test secret key:  $env:TOSS_SECRET_KEY = 'test_gsk_...'
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Secret key must stay on the server. The default is the public docs test key
# that pairs with the docs client key (test_gck_docs_...) in js/checkout.js.
$SecretKey = if ($env:TOSS_SECRET_KEY) { $env:TOSS_SECRET_KEY } else { 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6' }
if ($SecretKey -notlike 'test_*') { throw 'This is a test server. Use a test secret key (test_gsk_... / test_sk_...).' }

$FreeShippingMin = 30000
$ShippingFee = 3000
# Error codes when the customer closes the payment window (widget: USER_CANCEL, failUrl: PAY_PROCESS_CANCELED)
$CancelCodes = @('USER_CANCEL', 'PAY_PROCESS_CANCELED')

$root = $PSScriptRoot
$dataDir = Join-Path $root 'server-data'
$ordersFile = Join-Path $dataDir 'orders.json'
$orders = [ordered]@{}

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
}

# ---------- helpers ----------
function Send-Json($ctx, [int]$status, [string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-Error($ctx, [int]$status, [string]$code, [string]$message) {
  Send-Json $ctx $status (@{ code = $code; message = $message } | ConvertTo-Json -Compress)
}

function Read-Body($ctx) {
  $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd()
  $reader.Close()
  if (-not $text) { return $null }
  return $text | ConvertFrom-Json
}

function Save-Orders {
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory $dataDir | Out-Null }
  $json = ConvertTo-Json @($orders.Values) -Depth 10
  [IO.File]::WriteAllText($ordersFile, $json, (New-Object Text.UTF8Encoding $false))
}

# Prices come from js/products.js (one product per line), so the browser cannot change them.
function Get-Products {
  $src = [IO.File]::ReadAllText((Join-Path $root 'js\products.js'), [Text.Encoding]::UTF8)
  $re = 'id:\s*"(?<id>[^"]+)".*?sale:\s*(?<sale>\d+).*?free:\s*(?<free>true|false)'
  $map = @{}
  foreach ($m in [regex]::Matches($src, $re)) {
    $map[$m.Groups['id'].Value] = @{ sale = [int]$m.Groups['sale'].Value; free = ($m.Groups['free'].Value -eq 'true') }
  }
  return $map
}

function Get-OrderAmount($items) {
  $products = Get-Products
  $subtotal = 0
  $allFree = $true
  $count = 0
  foreach ($item in @($items)) {
    $p = $products[[string]$item.id]
    if (-not $p) { throw "Unknown product: $($item.id)" }
    $qty = [int]$item.qty
    if ($qty -lt 1 -or $qty -gt 10) { throw "Invalid quantity for $($item.id)" }
    $subtotal += $p.sale * $qty
    if (-not $p.free) { $allFree = $false }
    $count++
  }
  if ($count -eq 0) { throw 'Order has no items' }
  $shipping = if ($allFree -or $subtotal -ge $FreeShippingMin) { 0 } else { $ShippingFee }
  return $subtotal + $shipping
}

function Invoke-Toss([string]$path, $body) {
  $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SecretKey + ':'))
  $req = [Net.HttpWebRequest]::Create('https://api.tosspayments.com' + $path)
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Headers.Add('Authorization', 'Basic ' + $auth)
  $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()

  try {
    $res = $req.GetResponse()
  } catch [Net.WebException] {
    $res = $_.Exception.Response
    if (-not $res) { throw }
  }
  $reader = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd()
  $reader.Close()
  $status = [int]$res.StatusCode
  $res.Close()
  return @{ status = $status; body = $text }
}

# Same rules as the checkout form and lib/shop.js parseCustomer.
function Get-Customer($c) {
  if (-not $c) { throw 'Invalid customer name' }
  $name = ([string]$c.name).Trim()
  $phone = ([string]$c.phone) -replace '\D', ''
  $email = ([string]$c.email).Trim()
  $addr = ([string]$c.addr).Trim()
  if (-not $name -or $name.Length -gt 50) { throw 'Invalid customer name' }
  if ($phone -notmatch '^01\d{8,9}$') { throw 'Invalid customer phone' }
  if ($email -and ($email.Length -gt 100 -or $email -notmatch '^[^\s@]+@[^\s@]+$')) { throw 'Invalid customer email' }
  if (-not $addr -or $addr.Length -gt 200) { throw 'Invalid customer address' }
  return [ordered]@{ name = $name; phone = $phone; email = $email; addr = $addr }
}

function Get-Text($value, [int]$max) {
  $s = [string]$value
  if ($s.Length -gt $max) { $s = $s.Substring(0, $max) }
  return $s
}

# ---------- API routes ----------
function Handle-CreateOrder($ctx) {
  $body = Read-Body $ctx
  if (-not $body -or $body.orderId -notmatch '^[A-Za-z0-9_-]{6,64}$') {
    return Send-Error $ctx 400 'INVALID_ORDER_ID' 'orderId must be 6-64 chars of letters, digits, - or _'
  }
  if ($orders.Contains($body.orderId)) {
    return Send-Error $ctx 409 'DUPLICATED_ORDER_ID' 'orderId already exists'
  }
  try {
    $amount = Get-OrderAmount $body.items
  } catch {
    return Send-Error $ctx 400 'INVALID_ITEMS' $_.Exception.Message
  }
  try {
    $customer = Get-Customer $body.customer
  } catch {
    return Send-Error $ctx 400 'INVALID_CUSTOMER' $_.Exception.Message
  }

  $orders[$body.orderId] = [ordered]@{
    orderId     = $body.orderId
    orderName   = Get-Text $body.orderName 200
    amount      = $amount
    items       = @($body.items)
    status      = 'PENDING'
    customer    = $customer
    createdAt   = (Get-Date).ToString('o')
    updatedAt   = (Get-Date).ToString('o')
    failCode    = $null
    failMessage = $null
    payment     = $null
  }
  Save-Orders
  Write-Host "[order] $($body.orderId) amount=$amount"
  Send-Json $ctx 200 (@{ orderId = $body.orderId; amount = $amount } | ConvertTo-Json -Compress)
}

function Set-OrderFailed($order, [string]$status, $code, $message) {
  $order.status = $status
  $order.failCode = if ($code) { Get-Text $code 100 } else { 'UNKNOWN_ERROR' }
  $order.failMessage = if ($message) { Get-Text $message 500 } else { $null }
  $order.updatedAt = (Get-Date).ToString('o')
}

function Handle-Confirm($ctx) {
  $body = Read-Body $ctx
  if (-not $body -or -not $body.paymentKey -or -not $body.orderId) {
    return Send-Error $ctx 400 'INVALID_REQUEST' 'paymentKey, orderId and amount are required'
  }
  $order = $orders[[string]$body.orderId]
  if (-not $order) {
    return Send-Error $ctx 404 'ORDER_NOT_FOUND' 'Order not found (the server may have restarted)'
  }
  # Refreshing the success page: return the already confirmed payment.
  if ($order.payment) {
    if ($order.payment.paymentKey -eq $body.paymentKey) {
      return Send-Json $ctx 200 ($order.payment | ConvertTo-Json -Depth 10 -Compress)
    }
    return Send-Error $ctx 409 'DUPLICATED_ORDER' 'This order has already been paid'
  }
  if ([int]$body.amount -ne $order.amount) {
    return Send-Error $ctx 400 'AMOUNT_MISMATCH' "Amount does not match the order ($($order.amount))"
  }

  $result = Invoke-Toss '/v1/payments/confirm' @{ paymentKey = $body.paymentKey; orderId = $body.orderId; amount = $order.amount }
  $res = $result.body | ConvertFrom-Json
  if ($result.status -eq 200) {
    $order.status = $res.status
    $order.payment = $res
    $order.failCode = $null
    $order.failMessage = $null
    $order.updatedAt = (Get-Date).ToString('o')
  } else {
    Set-OrderFailed $order 'FAILED' $res.code $res.message
  }
  Save-Orders
  Write-Host "[confirm] $($body.orderId) -> $($result.status)"
  Send-Json $ctx $result.status $result.body
}

# Records why a payment did not complete. Paid orders are never changed.
function Handle-Fail($ctx) {
  $body = Read-Body $ctx
  if (-not $body -or $body.orderId -notmatch '^[A-Za-z0-9_-]{6,64}$') {
    return Send-Error $ctx 400 'INVALID_ORDER_ID' 'orderId must be 6-64 chars of letters, digits, - or _'
  }
  $status = if ($CancelCodes -contains $body.code) { 'USER_CANCELED' } else { 'FAILED' }
  $order = $orders[[string]$body.orderId]
  $updated = $false
  if ($order -and -not $order.payment) {
    Set-OrderFailed $order $status $body.code $body.message
    Save-Orders
    $updated = $true
  }
  Write-Host "[fail] $($body.orderId) -> $status (updated=$updated)"
  Send-Json $ctx 200 (@{ orderId = $body.orderId; status = $status; updated = $updated } | ConvertTo-Json -Compress)
}

# ---------- server ----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Test server running at http://localhost:$Port/  (Ctrl+C to stop)"
Write-Host "Secret key: $($SecretKey.Substring(0, 12))..."

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $method = $ctx.Request.HttpMethod
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')

      if ($path -eq 'api/orders' -and $method -eq 'POST') { Handle-CreateOrder $ctx; continue }
      if ($path -eq 'api/orders' -and $method -eq 'GET')  { Send-Json $ctx 200 (ConvertTo-Json @($orders.Values) -Depth 10); continue }
      if ($path -eq 'api/confirm' -and $method -eq 'POST') { Handle-Confirm $ctx; continue }
      if ($path -eq 'api/fail' -and $method -eq 'POST') { Handle-Fail $ctx; continue }
      if ($path.StartsWith('api/')) { Send-Error $ctx 404 'NOT_FOUND' 'Unknown API'; continue }

      # Static files (server-only files are not served)
      if ($path -eq '') { $path = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $path))
      $hidden = $path.StartsWith('server-data') -or $path.StartsWith('.') -or $full.EndsWith('.ps1')

      if (-not $hidden -and $full.StartsWith($root) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [IO.File]::ReadAllBytes($full)
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($method -ne 'HEAD') {
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      Write-Host "Request error: $_"
      try { Send-Error $ctx 500 'SERVER_ERROR' $_.Exception.Message } catch {}
    } finally {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
