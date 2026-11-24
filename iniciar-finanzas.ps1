# Starts the finanzas app: backend (port 3000) and frontend (port 4200), each in its own window, and opens the
# browser when the app answers. If a part is already running, it is not started again.
# To stop the app, close the two windows "Finanzas - back" and "Finanzas - front".

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# True when something listens on the port, over IPv4 or IPv6 (ng serve only listens on ::1, "localhost" in IPv6).
function Test-Port([int]$port) {
  foreach ($address in @('::1', '127.0.0.1')) {
    $client = $null
    try {
      $family = if ($address.Contains(':')) { 'InterNetworkV6' } else { 'InterNetwork' }
      $client = New-Object System.Net.Sockets.TcpClient($family)
      # 400 ms at most: Windows takes about 2 s to refuse a closed port.
      if ($client.ConnectAsync($address, $port).Wait(400) -and $client.Connected) { return $true }
    } catch {
      # not on this address: try the next one
    } finally {
      if ($client) { $client.Close() }
    }
  }
  return $false
}

if (-not (Test-Port 3000)) {
  Start-Process powershell -WorkingDirectory "$root\back" -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = 'Finanzas - back'; npm run start"
}
if (-not (Test-Port 4200)) {
  Start-Process powershell -WorkingDirectory "$root\front" -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = 'Finanzas - front'; npx ng serve --port 4200"
}

# Open the browser as soon as the frontend answers (checked every half second, 2 minutes at most).
$deadline = (Get-Date).AddMinutes(2)
while (-not (Test-Port 4200) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
Start-Process 'http://localhost:4200'
