#!/bin/bash
# Checks app CSS against STANDALONE-CSS-STANDARD.md. Exits 1 if any checked rule fails.
# Usage: scripts/check-css.sh [app-dir ...]   (defaults to the -LAB and id-jag working copies in ~/Development)
set -u
DEV="$HOME/Development"
apps=("$@")
[ ${#apps[@]} -eq 0 ] && apps=("$DEV/ai-gateway-client-LAB" "$DEV/mcp-demo-client-privilege-LAB" "$DEV/privilege-a2a-anthropic-demo-LAB" "$DEV/id-jag-standalone")
fail=0

# Every CSS file in an app, minus build output, dependencies and the shared stylesheet.
css_files() {
  find "$1" -name '*.css' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' \
    -not -name 'standalone-ui.css' 2>/dev/null
}

# Script files that can carry colours (reported only: some, like brand-contrast maths, are legitimate).
js_files() {
  find "$1" \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' -not -path '*/__tests__/*' \
    -not -name '*.test.*' -not -name 'vitest.config.*' 2>/dev/null
}

check_filtered() {  # $1 label, $2 regex, $3 extra filter pipeline, $4 "fail" or "report"
  local label="$1" pattern="$2" extra="$3" mode="$4" hits
  hits="$(for f in "${files[@]}"; do grep -n -E "$pattern" "$f" 2>/dev/null | sed "s|^|$f:|"; done | eval "$extra")"
  if [ -n "$hits" ]; then
    echo "$hits" | head -20 | sed 's/^/    /'
    n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$mode" = "fail" ]; then echo "  FAIL  $label ($n)"; fail=1; else echo "  note  $label ($n)"; fi
  else
    echo "  ok    $label"
  fi
}

check() {  # $1 label, $2 regex, $3 "fail" or "report"
  local label="$1" pattern="$2" mode="$3" hits
  hits="$(for f in "${files[@]}"; do grep -n -E "$pattern" "$f" 2>/dev/null | sed "s|^|$f:|"; done)"
  if [ -n "$hits" ]; then
    echo "$hits" | head -20 | sed 's/^/    /'
    n=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$mode" = "fail" ]; then echo "  FAIL  $label ($n)"; fail=1; else echo "  note  $label ($n)"; fi
  else
    echo "  ok    $label"
  fi
}

for app in "${apps[@]}"; do
  [ -d "$app" ] || { echo "skip (missing): $app"; continue; }
  echo "== $(basename "$app")"
  files=()
  while IFS= read -r f; do files+=("$f"); done < <(css_files "$app")
  if [ ${#files[@]} -eq 0 ]; then echo "  (no CSS files)"; continue; fi
  # Colour literals are allowed on a token DEFINITION line (--x: #hex in :root); the rule is
  # "use tokens", and the shared stylesheet itself defines its tokens this way. The grep -v
  # drops definition lines; what remains is a literal used directly in a rule.
  hits_filter="grep -v -E '^[^:]+:[0-9]+:[[:space:]]*--[a-z0-9-]+:[[:space:]]*(var\(|#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|linear-gradient)'"
  check_filtered "colour literals (use tokens)" '#[0-9a-fA-F]{3,8}([^0-9a-fA-F]|$)|rgba?\(|hsla?\(' "$hits_filter" fail
  check "no prefers-color-scheme outside the shared file" '@media[^{]*prefers-color-scheme' fail
  check "no !important outside the shared file" '!important' fail
  check "no italics" 'font-style:[[:space:]]*italic' fail
  check "id selectors (gap, reported only)" '(^|[ ,>+~])#[A-Za-z][A-Za-z0-9_-]*' report
  check "camelCase class names (gap, reported only)" '\.[a-z]+[A-Z][A-Za-z0-9]*[ ,{:.>]' report
  jsf=("${files[@]}"); files=(); while IFS= read -r f; do files+=("$f"); done < <(js_files "$app")
  check "colour literals in JS/JSX/TSX (reported only; use var(--token) or a CSS class)" "['\"]#[0-9a-fA-F]{3,8}['\"]" report
done
exit $fail
