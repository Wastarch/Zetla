; M0-15d · NSIS 卸载钩子：Zetla 代装 TeX Live 的保留询问
;
; 台账/标记约定（M0-15b/c 落地写入时须遵守；当前基线包无台账 → 本钩子静默跳过）：
;   TeX 台账：%LOCALAPPDATA%\Zetla\tex-install.txt —— 纯文本，每行一条 key=value；
;            键 texdir=TeX 安装根目录（如 C:\Users\<u>\AppData\Local\Zetla\tex\texlive）
;   TeX 标记：<texdir>\.zetla-tex（Zetla 安装成功后写入，证明该目录由 Zetla 代装）
;
; 行为：台账与标记都在且「非静默卸载」时，弹窗询问是否删除（默认否=保留，
;       与配置端口径一致：TeX 是 Zetla 之外可继续使用的独立软件）。
;       静默卸载 / 无台账 / 无标记 → 一律保留。

!ifndef ZETLA_TEX_HOOK_VARS
!define ZETLA_TEX_HOOK_VARS
Var ZetlaTexDir
!endif

!macro NSIS_HOOK_POSTUNINSTALL
  ClearErrors
  FileOpen $R2 "$LOCALAPPDATA\Zetla\tex-install.txt" r
  IfErrors zetla_tex_done
zetla_tex_next_line:
  FileRead $R2 $R3
  IfErrors zetla_tex_close
zetla_tex_trim:
  ; 去行尾 CR/LF（读到行尾把末字符逐个弹掉）
  StrCpy $R4 $R3 1 -1
  StrCmp $R4 "$\r" zetla_tex_trim_pop
  StrCmp $R4 "$\n" zetla_tex_trim_pop
  Goto zetla_tex_check
zetla_tex_trim_pop:
  StrCpy $R3 $R3 -1
  Goto zetla_tex_trim
zetla_tex_check:
  StrCpy $R4 $R3 7
  StrCmp $R4 "texdir=" 0 zetla_tex_next_line
  StrCpy $ZetlaTexDir $R3 "" 7
  Goto zetla_tex_close
zetla_tex_close:
  FileClose $R2
  StrCmp $ZetlaTexDir "" zetla_tex_done
  IfFileExists "$ZetlaTexDir\.zetla-tex" 0 zetla_tex_done
  IfSilent zetla_tex_done
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Zetla 安装的 TeX Live 环境仍保留在本机：$\r$\n$\r$\n$ZetlaTexDir$\r$\n$\r$\n是否同时删除？$\r$\n选「否」表示保留，TeX 可继续被其他软件使用。" \
    /SD IDNO IDNO zetla_tex_done
    RMDir /r "$ZetlaTexDir"
    Delete "$LOCALAPPDATA\Zetla\tex-install.txt"
zetla_tex_done:
!macroend
