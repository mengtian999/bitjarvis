$f = 'D:\Code\IM\bitjarvis\im\lib\l10n\intl_en.arb'
$c = [System.IO.File]::ReadAllText($f)

# Fix pattern: ":\"""{ => ": "{
$old1 = ":\"""{"
$new1 = ": ""{"
$c = $c.Replace($old1, $new1)

# Fix pattern: "\"""{ => ""{ (bare \" before "")
$old2 = "\"""{"
$new2 = ""{"
$c = $c.Replace($old2, $new2)

# Fix any remaining \" at start of value (after ": ")  
$old3 = ": \"{"
$new3 = ": ""{"
$c = $c.Replace($old3, $new3)

[System.IO.File]::WriteAllText($f, $c)
Write-Output "Done"