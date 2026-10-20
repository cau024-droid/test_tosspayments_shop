# Local test server (PowerShell only, no install needed)
#   - Serves the static shop pages
#   - POST /api/orders   : calculates the amount on the server and saves the order as PENDING
#   - POST /api/confirm  : checks the amount and calls the Toss Payments confirm API with the secret key
#   - POST /api/fail     : records why a payment did not complete (FAILED / USER_CANCELED)
#   - GET  /api/my-orders: lists the logged-in member's orders
#   - POST /api/cancel   : cancels (refunds) the logged-in member's paid order
#   - GET  /api/orders   : lists saved orders (for testing)
#   Members log in with Supabase Auth in the browser; this server checks the token with Supabase.
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

# Supabase Auth (same public values as js/common.js). Used only to check login tokens.
$SupabaseUrl = 'https://bxtfhadwhteljgzmuecy.supabase.co'
$SupabasePublishableKey = 'sb_publishable_0EP4VpNtaQIGY6W4cUFhWw_vvyxzeB4'
# Same rules as lib/shop.js
$CancelDays = 7
# Cancel reasons, written as \u escapes because Windows PowerShell 5.1 reads this file as ANSI
# (dansun byeonsim / wrong size / will buy another product / other)
$CancelReasons = @(
  '\ub2e8\uc21c \ubcc0\uc2ec',
  '\uc0ac\uc774\uc988\ub97c \uc798\ubabb \uace8\ub790\uc5b4\uc694',
  '\ub2e4\ub978 \uc0c1\ud488\uc73c\ub85c \ub2e4\uc2dc \uc0b4\uac8c\uc694',
  '\uae30\ud0c0'
) | ForEach-Object { [regex]::Unescape($_) }

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

function Invoke-Toss([string]$path, $body, [string]$idempotencyKey) {
  $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SecretKey + ':'))
  $req = [Net.HttpWebRequest]::Create('https://api.tosspayments.com' + $path)
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Headers.Add('Authorization', 'Basic ' + $auth)
  if ($idempotencyKey) { $req.Headers.Add('Idempotency-Key', $idempotencyKey) }
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

# Checks the browser's login token (Authorization: Bearer ...) with Supabase Auth.
# Returns $null for guests and throws 'UNAUTHORIZED' for a bad or expired token.
function Get-AuthUser($ctx) {
  $header = [string]$ctx.Request.Headers['Authorization']
  if (-not $header.StartsWith('Bearer ')) { return $null }
  $req = [Net.HttpWebRequest]::Create("$SupabaseUrl/auth/v1/user")
  $req.Headers.Add('apikey', $SupabasePublishableKey)
  $req.Headers.Add('Authorization', $header)
  try {
    $res = $req.GetResponse()
  } catch [Net.WebException] {
    if ($_.Exception.Response) { $_.Exception.Response.Close(); throw 'UNAUTHORIZED' }
    throw
  }
  $reader = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
  $user = $reader.ReadToEnd() | ConvertFrom-Json
  $reader.Close()
  $res.Close()
  return @{ id = [string]$user.id; email = [string]$user.email }
}

# Members can cancel a paid order themselves within 7 days of payment.
function Test-Cancelable($order) {
  if ($order.status -ne 'DONE' -or -not $order.payment -or -not $order.payment.approvedAt) { return $false }
  $approved = [DateTimeOffset]::Parse([string]$order.payment.approvedAt)
  return ([DateTimeOffset]::Now - $approved).TotalDays -le $CancelDays
}

# Same shape as lib/shop.js toMyOrder
function ConvertTo-MyOrder($order) {
  $p = $order.payment
  return [ordered]@{
    orderId        = $order.orderId
    orderName      = $order.orderName
    amount         = $order.amount
    items          = @($order.items)
    status         = $order.status
    createdAt      = $order.createdAt
    approvedAt     = if ($p) { $p.approvedAt } else { $null }
    method         = if ($p) { $p.method } else { $null }
    card           = if ($p -and $p.card) { $p.card.number } else { $null }
    receiptUrl     = if ($p -and $p.receipt) { $p.receipt.url } else { $null }
    customer       = $order.customer
    failCode       = $order.failCode
    failMessage    = $order.failMessage
    cancelReason   = $order.cancelReason
    canceledAt     = $order.canceledAt
    canceledAmount = $order.canceledAmount
    cancelable     = Test-Cancelable $order
  }
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
  # Logged-in members get the order linked to their account. Guests can still pay.
  try {
    $user = Get-AuthUser $ctx
  } catch {
    return Send-Error $ctx 401 'UNAUTHORIZED' 'Invalid or expired login'
  }

  $orders[$body.orderId] = [ordered]@{
    userId      = if ($user) { $user.id } else { $null }
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

function Get-MemberOrNull($ctx) {
  try { $user = Get-AuthUser $ctx } catch { $user = $null }
  if (-not $user) { Send-Error $ctx 401 'UNAUTHORIZED' 'Login required' }
  return $user
}

function Handle-MyOrders($ctx) {
  $user = Get-MemberOrNull $ctx
  if (-not $user) { return }
  $list = @($orders.Values | Where-Object { $_.userId -eq $user.id } | Sort-Object { $_.createdAt } -Descending |
    ForEach-Object { ConvertTo-MyOrder $_ })
  Send-Json $ctx 200 (@{ orders = $list } | ConvertTo-Json -Depth 10 -Compress)
}

function Handle-Cancel($ctx) {
  $user = Get-MemberOrNull $ctx
  if (-not $user) { return }
  $body = Read-Body $ctx
  if (-not $body -or $body.orderId -notmatch '^[A-Za-z0-9_-]{6,64}$') {
    return Send-Error $ctx 400 'INVALID_ORDER_ID' 'Invalid orderId'
  }
  if ($CancelReasons -notcontains [string]$body.reason) {
    return Send-Error $ctx 400 'INVALID_REASON' 'Choose a cancel reason'
  }
  $order = $orders[[string]$body.orderId]
  # Do not reveal other members' orders.
  if (-not $order -or $order.userId -ne $user.id) { return Send-Error $ctx 404 'ORDER_NOT_FOUND' 'Order not found' }
  if ($order.status -eq 'CANCELED' -or $order.status -eq 'PARTIAL_CANCELED') {
    return Send-Error $ctx 409 'ALREADY_CANCELED' 'This order is already canceled'
  }
  if (-not (Test-Cancelable $order)) {
    return Send-Error $ctx 400 'NOT_CANCELABLE' 'This order can no longer be canceled'
  }

  $path = '/v1/payments/' + [Uri]::EscapeDataString([string]$order.payment.paymentKey) + '/cancel'
  $result = Invoke-Toss $path @{ cancelReason = [string]$body.reason } "cancel-$($order.orderId)"
  Write-Host "[cancel] $($order.orderId) -> $($result.status)"
  if ($result.status -ne 200) { return Send-Json $ctx $result.status $result.body }

  $res = $result.body | ConvertFrom-Json
  $cancels = @($res.cancels)
  $order.status = $res.status
  $order.payment = $res
  $order.cancelReason = [string]$body.reason
  $order.canceledAt = if ($cancels.Count) { $cancels[-1].canceledAt } else { (Get-Date).ToString('o') }
  $order.canceledAmount = ($cancels | Measure-Object -Property cancelAmount -Sum).Sum
  $order.updatedAt = (Get-Date).ToString('o')
  Save-Orders
  Send-Json $ctx 200 (ConvertTo-MyOrder $order | ConvertTo-Json -Depth 10 -Compress)
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
      if ($path -eq 'api/my-orders' -and $method -eq 'GET') { Handle-MyOrders $ctx; continue }
      if ($path -eq 'api/cancel' -and $method -eq 'POST') { Handle-Cancel $ctx; continue }
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
