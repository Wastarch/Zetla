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
; WebView2 不在安装包内嵌（零体积增量）：安装时若系统缺失，则用系统 PowerShell
; 即时下载引导器并静默安装（缺 Runtime 的老 Win10 需要联网；已内置的用户无任何开销）。

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
  WebView2RegKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2BootstrapperUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

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

{ WebView2 运行时是否已安装（同时查 64 位原生视图与 32 位兼容视图）。 }
function IsWebView2Installed: Boolean;
var
  V: String;
begin
  Result :=
    (RegQueryStringValue(HKLM64, WebView2RegKey, 'pv', V) and (V <> '')) or
    (RegQueryStringValue(HKLM32, WebView2RegKey, 'pv', V) and (V <> ''));
end;

{ 安装时若系统缺少 WebView2：用系统 PowerShell 即时下载引导器并静默安装，
  不把引导器打进安装包（零体积增量）。安装时需联网；失败则提示手动安装。 }
procedure EnsureWebView2Runtime;
var
  TmpExe, PSFile, PSScript: String;
  ResultCode: Integer;
begin
  if IsWebView2Installed then
    Exit;

  TmpExe := ExpandConstant('{tmp}') + '\MicrosoftEdgeWebview2Setup.exe';
  PSFile := ExpandConstant('{tmp}') + '\get_webview2.ps1';
  PSScript :=
    '$ErrorActionPreference="Stop";' +
    'Invoke-WebRequest -Uri "' + WebView2BootstrapperUrl + '" -OutFile "' + TmpExe + '" -UseBasicParsing -MaximumRedirection 20;' +
    'Start-Process -FilePath "' + TmpExe + '" -ArgumentList "/silent" -Wait;';
  SaveStringToFile(PSFile, PSScript, False);

  if Exec('powershell.exe',
          '-NoProfile -ExecutionPolicy Bypass -File "' + PSFile + '"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if (ResultCode <> 0) or (not IsWebView2Installed) then
    begin
      if not WizardSilent then
        MsgBox('未能自动安装 WebView2 运行时（可能需要联网）。' + #13#10 +
               '请手动从以下地址安装后重新运行本安装程序：' + #13#10 +
               'https://developer.microsoft.com/microsoft-edge/webview2/',
               mbInformation, MB_OK);
    end;
  end
  else
  begin
    if not WizardSilent then
      MsgBox('未能启动下载以安装 WebView2 运行时。' + #13#10 +
             '请手动从以下地址安装后重新运行本安装程序：' + #13#10 +
             'https://developer.microsoft.com/microsoft-edge/webview2/',
             mbInformation, MB_OK);
  end;

  DeleteFile(PSFile);
  DeleteFile(TmpExe);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  { 文件落盘后、启动应用前，确保 WebView2 就绪；已安装则无任何开销。 }
  if CurStep = ssPostInstall then
    EnsureWebView2Runtime;
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
