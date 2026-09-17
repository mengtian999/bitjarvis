$f = 'D:\Code\IM\bitjarvis\im\lib\l10n\intl_en.arb'
$c = [System.IO.File]::ReadAllText($f)
$c = $c.Replace(':\"""{', ': ""{')
$c = $c.Replace('\"""{', '""{')
$c = $c.Replace('" \\""', '" ""')
[System.IO.File]::WriteAllText($f, $c)
Write-Output "Done"
