; Zetla · Inno Setup 正式安装包脚本（M0-15d）
;
; 用法（仓库根目录）：
;   npm run tauri build -- --no-bundle
;   npm run package:inno
;
; 版本号由 scripts/package-inno.mjs 从 src-tauri/tauri.conf.json 读取后通过
; /DMyAppVersion=<version> 传入；直接双击 IDE 编译时回退 0.0.0，仅用于语法检查。
;
; TeX Live 卸载约定（与 src-tauri/windows/nsis-hooks.nsh 保持一致）：
;   台账：%LOCALAPPDATA%\Zetla\tex-install.txt，纯文本每行 key=value，
;         其中 texdir=<TeX 安装根目录>
;   标记：<texdir>\.zetla-tex（Zetla 代装成功后写入）
;   行为：台账与标记都在且非静默卸载时，弹窗询问是否删除（默认保留）；
;         静默卸载 / 无台账 / 无标记时一律保留。

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "Zetla"
#define MyAppPublisher "Max"
#define MyAppExeName "zetla.exe"
#define MyAppId "{{B4680EB3-9D32-4C98-824D-A6DCCBBE6157}"

[Setup]
; 保持与 0.1.0/0.1.1 相同的 AppId，确保新包能覆盖升级而不是并存两份。
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
; 与 Tauri/WebView2 一致：x64 兼容（含 Windows 11 on Arm）。
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; 默认管理员安装（Program Files）；安装向导允许用户改为仅当前用户。
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\..\build\installer
OutputBaseFilename=Zetla_{#MyAppVersion}_x64-setup
SetupIconFile=..\..\icons\icon.ico
SolidCompression=yes
WizardStyle=modern
; 未签名：SmartScreen 会提示「更多信息 → 仍要运行」。
; WebView2 不随包分发，依赖系统已有 Runtime（Win10/11 通常内置）。

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\Chinese Simplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 前置：npm run tauri build -- --no-bundle 生成这两项。
Source: "..\..\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
const
  TexLedgerSubPath = '\Zetla\tex-install.txt';
  TexMarkerName = '.zetla-tex';

function GetTexLedgerPath: String;
begin
  Result := ExpandConstant('{localappdata}') + TexLedgerSubPath;
end;

function ReadTexDir: String;
var
  Lines: TArrayOfString;
  I: Integer;
  Line: String;
begin
  Result := '';
  if not FileExists(GetTexLedgerPath) then
    Exit;
  { Inno Setup 6.3+ 的 LoadStringsFromFile 支持无 BOM UTF-8。 }
  if not LoadStringsFromFile(GetTexLedgerPath, Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if Pos('texdir=', Line) = 1 then
    begin
      Result := Trim(Copy(Line, 8, Length(Line) - 7));
      Exit;
    end;
  end;
end;

function IsSafeTexDir(const Dir: String): Boolean;
begin
  { 只接受绝对路径，且拒绝空路径与盘符根（如 C:\）。 }
  Result := (Length(Dir) > 3) and (Pos(':\', Dir) = 2);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  TexDir: String;
  Marker: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;
  { 静默卸载一律保留，避免自动化/批量卸载误删。 }
  if UninstallSilent then
    Exit;

  TexDir := ReadTexDir;
  if not IsSafeTexDir(TexDir) then
    Exit;

  Marker := AddBackslash(TexDir) + TexMarkerName;
  if not FileExists(Marker) then
    Exit;

  if MsgBox(
       'Zetla 安装的 TeX Live 环境仍保留在本机：' + #13#10 + #13#10 +
       TexDir + #13#10 + #13#10 +
       '是否同时删除？' + #13#10 +
       '选「否」表示保留，TeX 可继续被其他软件使用。',
       mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then
    Exit;

  if DelTree(TexDir, True, True, True) then
    DeleteFile(GetTexLedgerPath);
end;
