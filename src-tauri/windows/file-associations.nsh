; Register Mozi as an "Open with" candidate without replacing the user's default.
; Tauri's APP_ASSOCIATE macro writes the .md default ProgID and is deliberately
; disabled on Windows by tauri.windows.conf.json.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\\Classes\\Applications\\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\\Classes\\Applications\\${MAINBINARYNAME}.exe\\shell\\open\\command" "" "$\"$INSTDIR\\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\\Classes\\.md\\OpenWithList\\${MAINBINARYNAME}.exe" "" ""
  WriteRegStr SHCTX "Software\\Classes\\.markdown\\OpenWithList\\${MAINBINARYNAME}.exe" "" ""
  WriteRegStr SHCTX "Software\\Classes\\.excalidraw\\OpenWithList\\${MAINBINARYNAME}.exe" "" ""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\\Classes\\.md\\OpenWithList\\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\\Classes\\.markdown\\OpenWithList\\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\\Classes\\.excalidraw\\OpenWithList\\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\\Classes\\Applications\\${MAINBINARYNAME}.exe"
!macroend
