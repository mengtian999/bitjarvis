import re
import os

f = r'D:\Code\IM\bitjarvis\im\lib\l10n\intl_en.arb'
with open(f, 'r', encoding='utf-8') as fh:
    c = fh.read()

# Fix 1: ":\"""{ => ": "{  (backslash-quote-doublequote-brace)
c = c.replace(':\\"""{', ': ""{')

# Fix 2: "\"""{ => ""{ (backslash-quote-doublequote-brace, no colon)
c = c.replace('\\"""{', '""{')

# Fix 3: Any remaining : \" at start of value where \" is not needed
# This is harder, let me just check the specific line

with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c)

print("Done")