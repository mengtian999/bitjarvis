 = 'D:\Code\IM\bitjarvis\im\lib\l10n\intl_en.arb'
 = [System.IO.File]::ReadAllText()

# Fix :\"""{  => : "{  (remove extra backslash and double quote)
 = .Replace(':\\"""{', ': ""{')

# Fix " ""{ => ""{ (remove backslash and one quote)
 = .Replace('\\"""{', '""{')

# Fix " \"" => " " (key" "value")
 = .Replace('" \\""', '" ""')

[System.IO.File]::WriteAllText(, )
Write-Output "Done"
