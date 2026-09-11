# localscope demo — search narrows live, impact shows exact blast radius

Output docs/demo.gif
Set FontSize 16
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set Margin 8

Hide
Type "cd /tmp/demo-repo"
Enter
Type "clear"
Enter
Type@50ms "node ~/Desktop/mcpserv/localscope/dist/index.js explore"
Enter
Sleep 1200ms
Show

# live search narrows as you type
Type@150ms "server"
Sleep 800ms
Backspace 6
Type@150ms "parse"
Sleep 800ms
Backspace 4
Type@150ms "validateConfig"
Sleep 600ms
Backspace 14

# pick parseConfig — see the blast radius with exact lines
Type@150ms "parseConfig"
Sleep 500ms
Enter
Sleep 1200ms

# walk the victims
Down
Sleep 400ms
Down
Sleep 400ms

# back to search, escape
Escape
Sleep 500ms
Ctrl+C
