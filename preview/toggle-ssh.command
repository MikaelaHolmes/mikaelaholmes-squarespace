#!/usr/bin/env bash
# Double-clickable from Finder. Toggles macOS Remote Login (incoming SSH)
# on or off. Shows the current state first, then asks to flip it. Uses
# AppleScript to get an admin password prompt via the GUI (no Terminal sudo).
#
# To put this on the Desktop:
#   ln -s "$HOME/Documents/Local Projects/mikaelaholmes-squarespace/preview/toggle-ssh.command" "$HOME/Desktop/Toggle Remote Access.command"
set -uo pipefail

state() {
  local s
  s=$(systemsetup -getremotelogin 2>/dev/null | awk -F': ' '{print $2}')
  [ -z "$s" ] && s="Unknown"
  echo "$s"
}

CURRENT="$(state)"
echo "==============================================="
echo " Remote Access (SSH)"
echo "-----------------------------------------------"
echo "  Currently:  $CURRENT"
echo "==============================================="
echo

if [ "$CURRENT" = "On" ]; then
  ACTION="off"; VERB="DISABLE"
else
  ACTION="on";  VERB="ENABLE"
fi

read -r -p "$VERB remote access?  [y/N] " ans
case "${ans:-N}" in
  y|Y|yes|YES)
    # Elevate via AppleScript so the user sees a normal admin prompt.
    if osascript -e "do shell script \"/usr/sbin/systemsetup -setremotelogin ${ACTION}\" with administrator privileges" >/dev/null; then
      echo
      echo "OK — remote access is now: $(state)"
    else
      echo
      echo "Cancelled or failed."
      exit 1
    fi
    ;;
  *)
    echo "No change."
    ;;
esac

echo
echo "(Press any key to close this window.)"
read -n 1 -s -r
