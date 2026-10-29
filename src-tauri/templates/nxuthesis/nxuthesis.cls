%%
%% This is file `nxuthesis.cls',
%% generated with the docstrip utility.
%%
%% The original source files were:
%% 
%% This is a generated file.
%% 
%% Copyright (C) 2024-2026 by Xianyuan Bao <baoxianyuan@126.com>
%% 
%% This work may be distributed and/or modified under the
%% conditions of the LaTeX Project Public License, either version 1.3c
%% of this license or (at your option) any later version.
%% The latest version of this license is in
%%    https://www.latex-project.org/lppl.txt
%% and version 1.3c or later is part of all distributions of LaTeX
%% version 2008 or later.
%% 
%% To produce the documentation run the original source files ending with `.dtx'
%% through LaTeX.
%% 
\NeedsTeXFormat{LaTeX2e}[2017/04/15]
\ProvidesClass{nxuthesis}
[2026/04/15 2.1.0 Ningxia University Thesis Template]
\newcommand\nxu@error[1]{%
  \ClassError{nxuthesis}{#1}{}%
}
\newcommand\nxu@warning[1]{%
  \ClassWarning{nxuthesis}{#1}%
}
\newcommand\nxu@debug[1]{%
  \typeout{Package nxuthesis Info: #1}%
}
\newcommand\nxu@patch@error[1]{%
  \nxu@error{Failed to patch command \protect#1}%
}
\newcommand\nxu@deprecate[2]{%
  \def\nxu@@tmp{#2}%
  \nxu@warning{%
    The #1 is deprecated%
    \ifx\nxu@@tmp\@empty\else
      . Use #2 instead%
    \fi
  }%
}
\@ifl@t@r\fmtversion{2017/04/15}{}{
  \nxu@error{%
    TeX Live 2017 or later version is required to compile this document%
  }
}
\RequirePackage{iftex}
\ifXeTeX\else
  \ifLuaTeX\else
    \nxu@error{XeLaTeX or LuaLaTeX is required to compile this document}
  \fi
\fi
\InputIfFileExists{nxuthesis-pdf-test-config.tex}{}{
  \InputIfFileExists{nxuthesis-log-test-config.tex}{}{}
}
\hyphenation{Nxu-Thesis}
\def\nxuthesis{nxuthesis}
\def\version{2.0.0}
\RequirePackage{kvdefinekeys}
\RequirePackage{kvsetkeys}
\RequirePackage{kvoptions}
\SetupKeyvalOptions{
  family=nxu,
  prefix=nxu@,
  setkeys=\kvsetkeys}
\let\nxu@setup@hook\@empty
\newcommand\nxusetup[1]{%
  \let\nxu@setup@hook\@empty
  \kvsetkeys{nxu}{#1}%
  \nxu@setup@hook
}
\newcommand\nxu@define@key[1]{%
  \kvsetkeys{nxu@key}{#1}%
}
\kv@set@family@handler{nxu@key}{%
  \@namedef{nxu@#1@@name}{#1}%
  \def\nxu@@default{}%
  \def\nxu@@choices{}%
  \kv@define@key{nxu@value}{name}{%
    \@namedef{nxu@#1@@name}{##1}%
  }%
  \@namedef{nxu@#1@@check}{}%
  \@namedef{nxu@#1@@code}{}%
  \kv@define@key{nxu@value}{choices}{%
    \def\nxu@@choices{##1}%
    \@namedef{nxu@#1@@reset}{}%
    \@namedef{nxu@#1@@check}{%
      \@ifundefined{%
        ifnxu@\@nameuse{nxu@#1@@name}@\@nameuse{nxu@\@nameuse{nxu@#1@@name}}%
      }{%
        \nxu@error{Invalid value "#1 = \@nameuse{nxu@\@nameuse{nxu@#1@@name}}"}%
      }%
      \@nameuse{nxu@#1@@reset}%
      \@nameuse{nxu@\@nameuse{nxu@#1@@name}@\@nameuse{nxu@\@nameuse{nxu@#1@@name}}true}%
    }%
  }%
  \kv@define@key{nxu@value}{default}{%
    \def\nxu@@default{##1}%
  }%
  \kvsetkeys{nxu@value}{#2}%
  \@namedef{nxu@\@nameuse{nxu@#1@@name}}{}%
  \kv@set@family@handler{nxu@choice}{%
    \ifx\nxu@@default\@empty
      \def\nxu@@default{##1}%
    \fi
    \expandafter\newif\csname ifnxu@\@nameuse{nxu@#1@@name}@##1\endcsname
    \expandafter\g@addto@macro\csname nxu@#1@@reset\endcsname{%
      \@nameuse{nxu@\@nameuse{nxu@#1@@name}@##1false}%
    }%
  }%
  \kvsetkeys@expandafter{nxu@choice}{\nxu@@choices}%
  \expandafter\let\csname nxu@\@nameuse{nxu@#1@@name}\endcsname\nxu@@default
  \expandafter\ifx\csname nxu@\@nameuse{nxu@#1@@name}\endcsname\@empty\else
    \@nameuse{nxu@#1@@check}%
  \fi
  \kv@define@key{nxu}{#1}{%
    \@namedef{nxu@\@nameuse{nxu@#1@@name}}{##1}%
    \@nameuse{nxu@#1@@check}%
    \@nameuse{nxu@#1@@code}%
  }%
}
\newcommand\nxu@option@hook[2]{%
  \expandafter\g@addto@macro\csname nxu@#1@@code\endcsname{#2}%
}
\nxu@define@key{
  thesis-type = {
    name = thesis@type,
    choices = {
      thesis,
      proposal,
    },
    default = thesis,
  },
  degree = {
    choices = {
      master,
      doctor,
    },
    default = master,
  },
  degree-type = {
    choices = {
      academic,
      professional,
    },
    name = degree@type,
  },
  main-language = {
    name = main@language,
    choices = {
      chinese,
      english,
    },
  },
  language = {
    choices = {
      chinese,
      english,
    },
  },
  system = {
    choices = {
      auto,
      mac,
      unix,
      windows,
    },
    default = auto,
  },
  fontset = {
    choices = {
      auto,
      windows,
      mac,
      ubuntu,
      fandol,
      none,
    },
    default = auto,
  },
  font = {
    choices = {
      auto,
      times,
      termes,
      stix,
      xits,
      libertinus,
      newcm,
      lm,
      newtx,
      none,
    },
    default = auto,
  },
  cjk-font = {
    name = cjk@font,
    choices = {
      auto,
      windows,
      windows-local,
      mac,
      mac-word,
      noto,
      fandol,
      none,
    },
    default = auto,
  },
  windows-font-dir = {
    name = windows@font@dir,
    default = {.},
  },
  math-font = {
    name = math@font,
    choices = {
      auto,
      stix,
      xits,
      libertinus,
      newcm,
      lm,
      newtx,
      none,
    },
    default = auto,
  },
  math-style = {
    name = math@style,
    choices = {
      GB,
      ISO,
      TeX,
    },
  },
  uppercase-greek = {
    name = uppercase@greek,
    choices = {
      italic,
      upright,
    },
  },
  less-than-or-equal = {
    name = leq,
    choices = {
      slanted,
      horizontal,
    },
  },
  integral = {
    choices = {
      upright,
      slanted,
    },
  },
  integral-limits = {
    name = integral@limits,
    choices = {
      true,
      false,
    },
  },
  partial = {
    choices = {
      upright,
      italic,
    },
  },
  math-ellipsis = {
    name = math@ellipsis,
    choices = {
      centered,
      lower,
      AMS,
    },
  },
  real-part = {
    name = real@part,
    choices = {
      roman,
      fraktur,
    },
  },
  output = {
    choices = {
      print,
      electronic,
    },
    default = print,
  },
}
\newif\ifnxu@degree@graduate
\newcommand\nxu@set@graduate{%
  \nxu@degree@graduatefalse
  \ifnxu@degree@doctor
    \nxu@degree@graduatetrue
  \fi
  \ifnxu@degree@master
    \nxu@degree@graduatetrue
  \fi
}
\nxu@set@graduate
\nxu@option@hook{degree}{%
  \nxu@set@graduate
}
\DeclareBoolOption[false]{openright}
\DeclareComplementaryOption{openany}{openright}
\DeclareBoolOption[true]{raggedbottom}
\DeclareDefaultOption{\PassOptionsToClass{\CurrentOption}{ctexbook}}
\ProcessKeyvalOptions*
\ifnxu@openright
  \PassOptionsToClass{openright}{book}
\else
  \PassOptionsToClass{openany}{book}
\fi
\PassOptionsToPackage{no-math}{fontspec}
\LoadClass[a4paper,UTF8,zihao=-4,scheme=plain,fontset=none]{ctexbook}[2017/04/01]
\RequirePackage{etoolbox}
\RequirePackage{filehook}
\RequirePackage{xparse}
\RequirePackage{geometry}%
\RequirePackage{fancyhdr}
\RequirePackage{titletoc}
\RequirePackage{notoccite}
\RequirePackage{amsmath}
\RequirePackage{graphicx}
\RequirePackage[labelformat=simple]{subcaption}
\RequirePackage{pdfpages}
\includepdfset{fitpaper=true}
\AtEndPreamble{
  \ifx\tikzifexternalizing\@undefined\else
    \tikzifexternalizing{
      \renewcommand*\includepdf[2][]{}
    }{}
  \fi
}
\RequirePackage[shortlabels]{enumitem}
\RequirePackage{environ}
\ifnxu@raggedbottom
  \RequirePackage[bottom,perpage,hang]{footmisc}
  \raggedbottom
\else
  \RequirePackage[perpage,hang]{footmisc}
\fi
\ifXeTeX
  \RequirePackage{xeCJKfntef}
\else
  \RequirePackage{ulem}
\fi
\RequirePackage{array}
\RequirePackage{booktabs}
\RequirePackage{url}
\AtEndPreamble{
  \@ifpackageloaded{biblatex}{}{
    \@ifpackageloaded{apacite}{}{
      \RequirePackage{natbib}
    }
  }
}
\AtEndOfPackageFile*{natbib}{
  \@ifpackageloaded{apacite}{}{
    \RequirePackage{bibunits}
  }
}
\newcommand\nxu@package@conflict[2]{%
  \AtEndOfPackageFile*{#1}{%
    \AtBeginOfPackageFile*{#2}{%
      \nxu@error{The "#2" package is incompatible with "#1"}%
    }%
  }%
}
\nxu@package@conflict{biblatex}{bibunits}
\nxu@package@conflict{biblatex}{chapterbib}
\nxu@package@conflict{biblatex}{cite}
\nxu@package@conflict{biblatex}{multibib}
\nxu@package@conflict{biblatex}{natbib}

\nxu@package@conflict{bibunits}{biblatex}
\nxu@package@conflict{bibunits}{chapterbib}
\nxu@package@conflict{bibunits}{multibib}

\nxu@package@conflict{unicode-math}{amscd}
\nxu@package@conflict{unicode-math}{amsfonts}
\nxu@package@conflict{unicode-math}{amssymb}
\nxu@package@conflict{unicode-math}{bbm}
\nxu@package@conflict{unicode-math}{bm}
\nxu@package@conflict{unicode-math}{eucal}
\nxu@package@conflict{unicode-math}{eufrak}
\nxu@package@conflict{unicode-math}{mathrsfs}
\nxu@package@conflict{unicode-math}{newtxmath}
\nxu@package@conflict{unicode-math}{upgreek}

\nxu@package@conflict{natbib}{biblatex}
\nxu@package@conflict{natbib}{cite}

\nxu@package@conflict{newtxmath}{amsfonts}
\nxu@package@conflict{newtxmath}{amssymb}
\nxu@package@conflict{newtxmath}{unicode-math}
\nxu@package@conflict{newtxmath}{upgreek}
\AtBeginOfPackageFile*{amsthm}{
  \@ifpackageloaded{newtxmath}{
    \nxu@error{The "amsthm" package should be loaded before setting "newtxmath"}
  }{}
}%
\geometry{
  paper          = a4paper,  % 210 * 297mm
  marginparwidth = 2cm,
  marginparsep   = 0.5cm,
  asymmetric, % 使奇偶页边距一致
}
\newcommand\nxu@set@geometry{%
    \geometry{
      top        = 3.0cm,
      bottom     = 3.0cm,
      left       = 3.0cm,
      right      = 2.5cm,
      headheight = 2.5cm,
      headsep    = 0.0cm,
      footskip   = 0.8cm,
    }%
}
\nxu@set@geometry
\nxu@option@hook{degree}{\nxu@set@geometry}
\nxu@option@hook{output}{\nxu@set@geometry}
\nxusetup{main-language=\nxu@language}%
\let\nxu@main@language\nxu@language
\nxu@option@hook{language}{%
  \ifx\@begindocumenthook\@undefined\else
    \nxusetup{main-language=\nxu@language}%
    \let\nxu@main@language\nxu@language
  \fi
}
\newcommand\nxu@reset@main@language{%
  \nxusetup{language = \nxu@main@language}%
  \let\nxu@language\nxu@main@language
}
\newcommand\nxu@set@chapter@names{%
  \ifnxu@main@language@chinese
    \def\nxu@comments@name{指导教师评语}%
    \def\bibname{参考文献}%
    \def\appendixname{附录}%
    \def\indexname{索引}%
    \def\nxu@resolution@name{答辩委员会决议书}%
      \def\listfigurename{插图清单}%
      \def\listtablename{附表清单}%
      \def\nxu@list@figure@table@name{插图和附表清单}%
      \def\nxu@list@algorithm@name{算法清单}%
      \def\listequationname{公式清单}%
      \def\nxu@acknowledgements@name{致\quad 谢}%
      \def\contentsname{目\quad 录}%
      \def\nxu@denotation@name{符号和缩略语说明}%
      \ifnxu@degree@master
        \def\nxu@resume@name{攻读学位期间发表的相关学术成果}%
      \else % degree = doctor
        \def\nxu@resume@name{攻读学位期间发表的相关学术成果}%
      \fi
  \else
    \ifnxu@main@language@english
      \def\nxu@comments@name{Comments from Thesis Supervisor}%
      \def\nxu@resolution@name{Resolution of Thesis Defense Committee}%
      \def\indexname{Index}%
        \def\contentsname{Table of Contents}%
        \def\listfigurename{List of Figures}%
        \def\listtablename{List of Tables}%
        \def\nxu@list@figure@table@name{List of Figures and Tables}%
        \def\nxu@list@algorithm@name{List of Algorithms}%
        \def\listequationname{List of Equations}%
        \def\nxu@denotation@name{List of Symbols and Acronyms}%
        \def\bibname{References}%
        \def\appendixname{Appendix}%
        \def\nxu@acknowledgements@name{Acknowledgements}%
        \def\nxu@resume@name{Resume}%
    \fi
  \fi
}
\nxu@set@chapter@names
\nxu@option@hook{degree}{\nxu@set@chapter@names}
\nxu@option@hook{main-language}{\nxu@set@chapter@names}
\newcommand\nxu@set@names{%
  \ifnxu@language@chinese
    \ctexset{
      figurename = 图,
      tablename  = 表,
    }%
    \def\nxu@algorithm@name{算法}%
    \def\nxu@equation@name{公式}%
    \def\nxu@assumption@name{假设}%
    \def\nxu@definition@name{定义}%
    \def\nxu@proposition@name{命题}%
    \def\nxu@lemma@name{引理}%
    \def\nxu@theorem@name{定理}%
    \def\nxu@axiom@name{公理}%
    \def\nxu@corollary@name{推论}%
    \def\nxu@exercise@name{练习}%
    \def\nxu@example@name{例}%
    \def\nxu@remark@name{注释}%
    \def\nxu@problem@name{问题}%
    \def\nxu@conjecture@name{猜想}%
    \def\nxu@proof@name{证明}%
    \def\nxu@theorem@separator{：}%
  \else
    \ifnxu@language@english
      \ctexset{
        figurename = {Figure},
        tablename  = {Table},
      }%
      \def\nxu@algorithm@name{Algorithm}%
      \def\nxu@equation@name{Equation}%
      \def\nxu@assumption@name{Assumption}%
      \def\nxu@definition@name{Definition}%
      \def\nxu@proposition@name{Proposition}%
      \def\nxu@lemma@name{Lemma}%
      \def\nxu@theorem@name{Theorem}%
      \def\nxu@axiom@name{Axiom}%
      \def\nxu@corollary@name{Corollary}%
      \def\nxu@exercise@name{Exercise}%
      \def\nxu@example@name{Example}%
      \def\nxu@remark@name{Remark}%
      \def\nxu@problem@name{Problem}%
      \def\nxu@conjecture@name{Conjecture}%
      \def\nxu@proof@name{Proof}%
      \def\nxu@theorem@separator{: }%
    \fi
  \fi
}
\nxu@set@names
\nxu@option@hook{language}{\nxu@set@names}
\ifLuaTeX
  % ctex 将带圈数字 U+2460–U+24FF 归入字符范围 3（ALchar），这里改回范围 6（JAchar）
  \ltjdefcharrange{3}{%
    "2000-"243F, "2500-"27BF, "2900-"29FF, "2B00-"2BFF}
  \ltjdefcharrange{6}{%
    "2460-"24FF, "2E80-"2EFF, "3000-"30FF, "3190-"319F, "31F0-"4DBF,
    "4E00-"9FFF, "F900-"FAFF, "FE10-"FE1F, "FE30-"FE6F, "FF00-"FFEF,
    "1B000-"1B16F, "1F100-"1F2FF, "20000-"3FFFF, "E0100-"E01EF}
\else
  \ifXeTeX
    \xeCJKDeclareCharClass{CJK}{"2460 -> "2473}
    \xeCJKDeclareCharClass{CJK}{"2605}
  \fi
\fi
\newcommand\nxu@set@punctuations{%
  \ifnxu@language@chinese
    \ifLuaTeX
      \ltjsetparameter{jacharrange={+9}}
    \else
      \ifXeTeX
        \xeCJKDeclareCharClass{FullLeft}{"2018, "201C}%
        \xeCJKDeclareCharClass{FullRight}{
          "00B7, "2019, "201D, "2013, "2014, "2025, "2026, "2E3A,
        }%
      \fi
    \fi
  \else
    \ifnxu@language@english
      \ifLuaTeX
        \ltjsetparameter{jacharrange={-9}}
      \else
        \ifXeTeX
          \xeCJKDeclareCharClass{HalfLeft}{"2018, "201C}%
          \xeCJKDeclareCharClass{HalfRight}{
            "00B7, "2019, "201D, "2013, "2014, "2025, "2026, "2E3A,
          }%
        \fi
      \fi
    \fi
  \fi
}
\nxu@set@punctuations
\nxu@option@hook{language}{\nxu@set@punctuations}
\renewcommand\normalsize{%
  \@setfontsize\normalsize{12bp}{20bp}%
  \abovedisplayskip 6bp%
  \abovedisplayshortskip 6bp%
  \belowdisplayshortskip 6bp%
  \belowdisplayskip \abovedisplayskip
}
\normalsize
\ifx\MakeRobust\@undefined \else
    \MakeRobust\normalsize
\fi
\def\nxu@def@fontsize#1#2{%
  \expandafter\newcommand\csname #1\endcsname[1][1.3]{%
    \fontsize{#2}{##1\dimexpr #2}\selectfont}}
\nxu@def@fontsize{chuhao}{42bp}
\nxu@def@fontsize{xiaochu}{36bp}
\nxu@def@fontsize{yihao}{26bp}
\nxu@def@fontsize{xiaoyi}{24bp}
\nxu@def@fontsize{erhao}{22bp}
\nxu@def@fontsize{xiaoer}{18bp}
\nxu@def@fontsize{sanhao}{16bp}
\nxu@def@fontsize{xiaosan}{15bp}
\nxu@def@fontsize{sihao}{14bp}
\nxu@def@fontsize{xiaosi}{12bp}
\nxu@def@fontsize{wuhao}{10.5bp}
\nxu@def@fontsize{xiaowu}{9bp}
\nxu@def@fontsize{liuhao}{7.5bp}
\nxu@def@fontsize{xiaoliu}{6.5bp}
\nxu@def@fontsize{qihao}{5.5bp}
\nxu@def@fontsize{bahao}{5bp}
\ifnxu@system@auto
  \IfFileExists{/System/Library/Fonts/Menlo.ttc}{
    \nxusetup{system = mac}
  }{
    \IfFileExists{/dev/null}{
      \IfFileExists{null:}{
        \nxusetup{system = windows}
      }{
        \nxusetup{system = unix}
      }
    }{
      \nxusetup{system = windows}
    }
  }
  \nxu@debug{Detected system: \nxu@system}
\fi
\newcommand\nxu@mac@word@font@dir{%
  /Applications/Microsoft Word.app/Contents/Resources/DFonts%
}
\ifnxu@fontset@auto
  \ifnxu@system@windows
    \nxusetup{fontset = windows}
  \else
    \IfFontExistsTF{SimSun}{
      \nxusetup{fontset = windows}
    }{
      \IfFileExists{\nxu@windows@font@dir/Simsun.ttc}{
        \nxusetup{fontset = windows, cjk-font = windows-local}
      }{
        \IfFileExists{\nxu@mac@word@font@dir/Simsun.ttc}{
          \nxusetup{fontset = windows, cjk-font = mac-word}
        }{
          \ifnxu@system@mac
            \nxusetup{fontset = mac}
          \else
            \IfFontExistsTF{Noto Serif CJK SC}{
              \nxusetup{fontset = ubuntu}
            }{
              \nxusetup{fontset = fandol}
            }
          \fi
        }
      }
    }
  \fi
  \nxu@debug{Detected fontset: \nxu@fontset}
\fi
\newcommand\nxu@set@font{%
  \@nameuse{nxu@set@font@\nxu@font}%
}
\nxu@option@hook{font}{\nxu@set@font}
\newcommand\nxu@set@font@auto{%
  \ifnxu@font@auto
    \ifnxu@fontset@windows
      \nxusetup{font=times}%
    \else
      \ifnxu@fontset@mac
        \nxusetup{font=times}%
      \else
        \nxusetup{font=termes}%
      \fi
    \fi
  \fi
}
\nxu@option@hook{math-font}{\g@addto@macro\nxu@setup@hook{\nxu@set@font@auto}}
\AtBeginOfPackageFile*{siunitx}{\nxu@set@font@auto}
\AtEndPreamble{\nxu@set@font@auto}
\newcommand\nxu@set@font@times{%
  \setmainfont{Times New Roman}%
  \setsansfont{Times New Roman}%
  %\setsansfont{Arial}%
  \ifnxu@fontset@mac
    \setmonofont{Menlo}[Scale = MatchLowercase]%
  \else
    \setmonofont{Courier New}[Scale = MatchLowercase]%
  \fi
}
\newcommand\nxu@set@font@termes{%
  \setmainfont{texgyretermes}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic,
  ]%
  \nxu@set@texgyre@sans@mono
}
\newcommand\nxu@set@texgyre@sans@mono{%
  \setsansfont{texgyreheros}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic,
  ]%
  \setmonofont{texgyrecursor}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic,
    Scale          = MatchLowercase,
    Ligatures      = CommonOff,
  ]%
}
\let\nxu@font@family@stix\@empty
\newcommand\nxu@set@stix@names{%
  \ifx\nxu@font@family@stix\@empty
    \IfFontExistsTF{STIXTwoText-Regular.otf}{%
      \gdef\nxu@font@family@stix{STIXTwoText}%
      \gdef\nxu@font@name@stix@math{STIXTwoMath-Regular}%
    }{%
      \gdef\nxu@font@family@stix{STIX2Text}%
      \gdef\nxu@font@name@stix@math{STIX2Math}%
    }%
  \fi
}
\newcommand\nxu@set@font@stix{%
  \nxu@set@stix@names
  \setmainfont{\nxu@font@family@stix}[
    Extension      = .otf,
    UprightFont    = *-Regular,
    BoldFont       = *-Bold,
    ItalicFont     = *-Italic,
    BoldItalicFont = *-BoldItalic,
  ]%
  \nxu@set@texgyre@sans@mono
}
\let\nxu@font@family@xits\@empty
\newcommand\nxu@set@xits@names{%
  \ifx\nxu@font@family@xits\@empty
    \IfFontExistsTF{XITSMath-Regular.otf}{%
      \gdef\nxu@font@family@xits{XITS}%
      \gdef\nxu@font@style@xits@rm{Regular}%
      \gdef\nxu@font@style@xits@bf{Bold}%
      \gdef\nxu@font@style@xits@it{Italic}%
      \gdef\nxu@font@style@xits@bfit{BoldItalic}%
      \gdef\nxu@font@name@xits@math{XITSMath-Regular}%
    }{%
      \gdef\nxu@font@family@xits{xits}%
      \gdef\nxu@font@style@xits@rm{regular}%
      \gdef\nxu@font@style@xits@bf{bold}%
      \gdef\nxu@font@style@xits@it{italic}%
      \gdef\nxu@font@style@xits@bfit{bolditalic}%
      \gdef\nxu@font@name@xits@math{xits-math}%
    }%
  \fi
}
\newcommand\nxu@set@font@xits{%
  \nxu@set@xits@names
  \setmainfont{\nxu@font@family@xits}[
    Extension      = .otf,
    UprightFont    = *-\nxu@font@style@xits@rm,
    BoldFont       = *-\nxu@font@style@xits@bf,
    ItalicFont     = *-\nxu@font@style@xits@it,
    BoldItalicFont = *-\nxu@font@style@xits@bfit,
  ]%
  \nxu@set@texgyre@sans@mono
}
\let\nxu@font@family@libertinus\@empty
\newcommand\nxu@set@libertinus@names{%
  \ifx\nxu@font@family@libertinus\@empty
    \IfFontExistsTF{LibertinusSerif-Regular.otf}{%
      \gdef\nxu@font@family@libertinus@serif{LibertinusSerif}%
      \gdef\nxu@font@family@libertinus@sans{LibertinusSans}%
      \gdef\nxu@font@name@libertinus@math{LibertinusMath-Regular}%
      \gdef\nxu@font@style@libertinus@rm{Regular}%
      \gdef\nxu@font@style@libertinus@bf{Bold}%
      \gdef\nxu@font@style@libertinus@it{Italic}%
      \gdef\nxu@font@style@libertinus@bfit{BoldItalic}%
    }{%
      \gdef\nxu@font@family@libertinus@serif{libertinusserif}%
      \gdef\nxu@font@family@libertinus@sans{libertinussans}%
      \gdef\nxu@font@name@libertinus@math{libertinusmath-regular}%
      \gdef\nxu@font@style@libertinus@rm{regular}%
      \gdef\nxu@font@style@libertinus@bf{bold}%
      \gdef\nxu@font@style@libertinus@it{italic}%
      \gdef\nxu@font@style@libertinus@bfit{bolditalic}%
    }%
  \fi
}
\newcommand\nxu@set@font@libertinus{%
  \nxu@set@libertinus@names
  \setmainfont{\nxu@font@family@libertinus@serif}[
    Extension      = .otf,
    UprightFont    = *-\nxu@font@style@libertinus@rm,
    BoldFont       = *-\nxu@font@style@libertinus@bf,
    ItalicFont     = *-\nxu@font@style@libertinus@it,
    BoldItalicFont = *-\nxu@font@style@libertinus@bfit,
  ]%
  \setsansfont{\nxu@font@family@libertinus@sans}[
    Extension      = .otf,
    UprightFont    = *-\nxu@font@style@libertinus@rm,
    BoldFont       = *-\nxu@font@style@libertinus@bf,
    ItalicFont     = *-\nxu@font@style@libertinus@it,
  ]%
  \setmonofont{lmmonolt10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-oblique,
    BoldItalicFont = *-boldoblique,
  ]%
}
\newcommand\nxu@set@font@newcm{%
  \setmainfont{NewCM10}[
    Extension      = .otf,
    UprightFont    = *-Book,
    BoldFont       = *-Bold,
    ItalicFont     = *-BookItalic,
    BoldItalicFont = *-BoldItalic,
  ]%
  \setsansfont{NewCMSans10}[
    Extension         = .otf,
    UprightFont       = *-Book,
    BoldFont          = *-Bold,
    ItalicFont        = *-BookOblique,
    BoldItalicFont    = *-BoldOblique,
  ]%
  \setmonofont{NewCMMono10}[
    Extension           = .otf,
    UprightFont         = *-Book,
    ItalicFont          = *-BookItalic,
    BoldFont            = *-Bold,
    BoldItalicFont      = *-BoldOblique,
  ]%
}
\newcommand\nxu@set@font@lm{%
  \setmainfont{lmroman10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic,
  ]%
  \setsansfont{lmsans10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-oblique,
    BoldItalicFont = *-boldoblique,
  ]%
  \setmonofont{lmmonolt10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-oblique,
    BoldItalicFont = *-boldoblique,
  ]%
}
\newcommand\nxu@set@font@newtx{%
  \RequirePackage{newtxtext}%
}
\ifnxu@cjk@font@auto
  \ifnxu@fontset@mac
    \nxusetup{cjk-font = mac}
  \else
    \ifnxu@fontset@windows
      \IfFontExistsTF{SimSun}{
        \nxusetup{cjk-font = windows}
      }{
        \IfFileExists{\nxu@windows@font@dir/Simsun.ttc}{
          \nxusetup{cjk-font = windows-local}
        }{
          \IfFileExists{\nxu@mac@word@font@dir/Simsun.ttc}{
            \nxusetup{cjk-font = mac-word}
          }{
            \nxu@error{Cannot find "SimSun" font}
          }
        }
      }
    \else
      \ifnxu@fontset@ubuntu
        \nxusetup{cjk-font = noto}
      \else
        \nxusetup{cjk-font = fandol}
      \fi
    \fi
  \fi
  \nxu@debug{Detected CJK font: \nxu@cjk@font}
\fi
\newcommand\nxu@set@cjk@font@windows{%
  \setCJKmainfont{SimSun}[
    AutoFakeBold = 3,
    ItalicFont   = KaiTi,
  ]%
  \setCJKsansfont{SimHei}[AutoFakeBold = 3]%
  \setCJKmonofont{FangSong}%
  \setCJKfamilyfont{zhsong}{SimSun}[AutoFakeBold = 3]%
  \setCJKfamilyfont{zhhei}{SimHei}[AutoFakeBold = 3]%
  \setCJKfamilyfont{zhkai}{KaiTi}%
  \setCJKfamilyfont{zhfs}{FangSong}%
}
\@namedef{nxu@set@cjk@font@windows-local}{%
  \IfFileExists{\nxu@windows@font@dir/Kaiti.ttf}{
    \setCJKmainfont{SimSun}[%
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttc,
      AutoFakeBold = 3,
      ItalicFont   = Kaiti,
      ItalicFeatures = {Extension = .ttf},
    ]%
    \setCJKmonofont{Fangsong}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
    \setCJKfamilyfont{zhkai}{Kaiti}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
    \setCJKfamilyfont{zhfs}{Fangsong}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
  }{
    \setCJKmainfont{SimSun}[%
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttc,
      AutoFakeBold = 3,
      ItalicFont   = Simkai,
      ItalicFeatures = {Extension = .ttf},
    ]%
    \setCJKmonofont{Simfang}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
    \setCJKfamilyfont{zhkai}{Simkai}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
    \setCJKfamilyfont{zhfs}{Simfang}[
      Path         = \nxu@windows@font@dir/,
      Extension    = .ttf,
    ]%
  }
  \setCJKsansfont{SimHei}[%
    Path         = \nxu@windows@font@dir/,
    Extension    = .ttf,
    AutoFakeBold = 3,
  ]%
  \setCJKfamilyfont{zhsong}{SimSun}[%
    Path         = \nxu@windows@font@dir/,
    Extension    = .ttc,
    AutoFakeBold = 3,
  ]%
  \setCJKfamilyfont{zhhei}{SimHei}[%
    Path         = \nxu@windows@font@dir/,
    Extension    = .ttf,
    AutoFakeBold = 3,
  ]%
}
\@namedef{nxu@set@cjk@font@mac-word}{%
  \let\nxu@windows@font@dir\nxu@mac@word@font@dir
  \@nameuse{nxu@set@cjk@font@windows-local}%
}
\newcommand\nxu@set@cjk@font@mac{%
  \defaultCJKfontfeatures{}%
  \setCJKmainfont{Songti SC}[
    UprightFont    = * Light,
    BoldFont       = * Bold,
    ItalicFont     = Kaiti SC Regular,
    BoldItalicFont = Kaiti SC Bold,
  ]%
  \setCJKsansfont{Heiti SC}[
    UprightFont    = * Light,
    BoldFont       = * Medium,
  ]%
  \setCJKmonofont{STFangsong}
  \setCJKfamilyfont{zhsong}{Songti SC}[
    UprightFont    = * Light,
    BoldFont       = * Bold,
  ]%
  \setCJKfamilyfont{zhhei}{Heiti SC}[
    UprightFont    = * Light,
    BoldFont       = * Medium,
  ]%
  \setCJKfamilyfont{zhfs}{STFangsong}%
  \setCJKfamilyfont{zhkai}{Kaiti SC}[
    UprightFont    = * Regular,
    BoldFont       = * Bold,
  ]%
  \setCJKfamilyfont{zhli}{Baoli SC}%
  \setCJKfamilyfont{zhyuan}{Yuanyi SC}[
    UprightFont    = * Light,
    BoldFont       = * Bold,
  ]%
}
\newcommand\nxu@set@cjk@font@noto{%
  \defaultCJKfontfeatures{}%
  \setCJKmainfont{Noto Serif CJK SC}[
    UprightFont    = * Light,
    BoldFont       = * Bold,
    ItalicFont     = FandolKai-Regular,
    ItalicFeatures = {Extension = .otf},
    Script         = CJK,
  ]%
  \setCJKsansfont{Noto Sans CJK SC}[
    BoldFont       = * Medium,
    Script         = CJK,
  ]%
  \setCJKmonofont{Noto Sans Mono CJK SC}[
    Script         = CJK,
  ]%
  \setCJKfamilyfont{zhsong}{Noto Serif CJK SC}[
    UprightFont    = * Light,
    UprightFont    = * Bold,
    Script         = CJK,
  ]%
  \setCJKfamilyfont{zhhei}{Noto Sans CJK SC}[
    BoldFont       = * Medium,
    Script         = CJK,
  ]%
  \setCJKfamilyfont{zhfs}{FandolFang}[
    Extension      = .otf,
    UprightFont    = *-Regular,
  ]%
  \setCJKfamilyfont{zhkai}{FandolKai}[
    Extension      = .otf,
    UprightFont    = *-Regular,
  ]%
}
\newcommand\nxu@set@cjk@font@fandol{%
  \defaultCJKfontfeatures{}%
  \setCJKmainfont{FandolSong}[
    Extension   = .otf,
    UprightFont = *-Regular,
    BoldFont    = *-Bold,
    ItalicFont  = FandolKai-Regular,
    ItalicFeatures = {Extension = .otf},
  ]%
  \setCJKsansfont{FandolHei}[
    Extension   = .otf,
    UprightFont = *-Regular,
    BoldFont    = *-Bold,
  ]%
  \setCJKmonofont{FandolFang}[
    Extension   = .otf,
    UprightFont = *-Regular,
  ]%
  \setCJKfamilyfont{zhsong}{FandolSong}[
    Extension   = .otf,
    UprightFont = *-Regular,
    BoldFont    = *-Bold,
  ]%
  \setCJKfamilyfont{zhhei}{FandolHei}[
    Extension   = .otf,
    UprightFont = *-Regular,
    BoldFont    = *-Bold,
  ]%
  \setCJKfamilyfont{zhfs}{FandolFang}[
    Extension   = .otf,
    UprightFont = *-Regular,
  ]%
  \setCJKfamilyfont{zhkai}{FandolKai}[
    Extension   = .otf,
    UprightFont = *-Regular,
  ]%
}
\ifnxu@cjk@font@none\else
  \providecommand\songti{\CJKfamily{zhsong}}
  \providecommand\heiti{\CJKfamily{zhhei}}
  \providecommand\fangsong{\CJKfamily{zhfs}}
  \providecommand\kaishu{\CJKfamily{zhkai}}
\fi
\newcommand\nxu@set@cjk@font{%
  \@nameuse{nxu@set@cjk@font@\nxu@cjk@font}%
}
\nxu@set@cjk@font
\nxu@option@hook{cjk-font}{\nxu@set@cjk@font}
\newcommand\nxu@set@math@style{%
  \ifnxu@math@style@TeX
    \nxusetup{
      uppercase-greek    = upright,
      less-than-or-equal = horizontal,
      integral           = slanted,
      integral-limits    = false,
      partial            = italic,
      math-ellipsis      = AMS,
      real-part          = fraktur,
    }%
  \else
    \nxusetup{
      uppercase-greek = italic,
      integral        = upright,
      partial         = upright,
      real-part       = roman,
    }%
    \ifnxu@math@style@ISO
      \nxusetup{
        less-than-or-equal = horizontal,
        integral-limits    = true,
        math-ellipsis      = lower,
      }%
    \else
      \ifnxu@math@style@GB
        \nxusetup{
          less-than-or-equal = slanted,
          integral-limits    = false,
          math-ellipsis      = centered,
        }%
      \fi
    \fi
  \fi
}
\ifnxu@main@language@chinese
  \nxusetup{math-style=GB}%
\else
  \nxusetup{math-style=TeX}%
\fi
\nxu@set@math@style
\nxu@option@hook{math-style}{\nxu@set@math@style}
\nxu@option@hook{main-language}{%
  \ifnxu@main@language@chinese
    \nxusetup{math-style=GB}%
  \else
    \nxusetup{math-style=TeX}%
  \fi
}
\newcommand\nxu@set@unimath@leq{%
  \ifnxu@leq@horizontal
    \ifx\@begindocumenthook\@undefined
      \let\le\nxu@save@leq
      \let\ge\nxu@save@geq
      \let\leq\nxu@save@leq
      \let\geq\nxu@save@geq
    \else
      \AtBeginDocument{%
        \let\le\nxu@save@leq
        \let\ge\nxu@save@geq
        \let\leq\nxu@save@leq
        \let\geq\nxu@save@geq
      }%
    \fi
  \else
    \ifnxu@leq@slanted
      \ifx\@begindocumenthook\@undefined
        \let\le\leqslant
        \let\ge\geqslant
        \let\leq\leqslant
        \let\geq\geqslant
      \else
        \AtBeginDocument{%
          \let\le\leqslant
          \let\ge\geqslant
          \let\leq\leqslant
          \let\geq\geqslant
        }%
      \fi
    \fi
  \fi
}
\newcommand\nxu@set@unimath@integral@limits{%
  \ifnxu@integral@limits@true
    \removenolimits{%
      \int\iint\iiint\iiiint\oint\oiint\oiiint
      \intclockwise\varointclockwise\ointctrclockwise\sumint
      \intbar\intBar\fint\cirfnint\awint\rppolint
      \scpolint\npolint\pointint\sqint\intlarhk\intx
      \intcap\intcup\upint\lowint
    }%
  \else
    \addnolimits{%
      \int\iint\iiint\iiiint\oint\oiint\oiiint
      \intclockwise\varointclockwise\ointctrclockwise\sumint
      \intbar\intBar\fint\cirfnint\awint\rppolint
      \scpolint\npolint\pointint\sqint\intlarhk\intx
      \intcap\intcup\upint\lowint
    }%
  \fi
}
\newcommand\nxu@set@unimath@ellipsis{%
  \ifnxu@math@ellipsis@centered
    \DeclareRobustCommand\mathellipsis{\mathinner{\unicodecdots}}%
  \else
    \DeclareRobustCommand\mathellipsis{\mathinner{\unicodeellipsis}}%
  \fi
}
\newcommand\nxu@set@unimath@real@part{%
  \ifnxu@real@part@roman
    \AtBeginDocument{%
      \def\Re{\operatorname{Re}}%
      \def\Im{\operatorname{Im}}%
    }%
  \else
    \AtBeginDocument{%
      \let\Re\nxu@save@Re
      \let\Im\nxu@save@Im
    }%
  \fi
}
\newcommand\nxu@set@unimath@style{%
  \ifnxu@uppercase@greek@upright
    \unimathsetup{math-style = TeX}%
  \else
    \ifnxu@uppercase@greek@italic
      \unimathsetup{math-style = ISO}%
    \fi
  \fi
  \ifnxu@math@style@TeX
    \unimathsetup{bold-style = TeX}%
  \else
    \unimathsetup{bold-style = ISO}%
  \fi
  \nxu@set@unimath@leq
  \nxu@set@unimath@integral@limits
  \ifnxu@partial@upright
    \unimathsetup{partial = upright}%
  \else
    \ifnxu@partial@italic
      \unimathsetup{partial = italic}%
    \fi
  \fi
  \nxu@set@unimath@ellipsis
  \nxu@set@unimath@real@part
}
\newcommand\nxu@qed{\rule{1ex}{1ex}}
\newcommand\nxu@load@unimath{%
  \@ifpackageloaded{unicode-math}{}{%
    \RequirePackage{unicode-math}%
    \AtBeginDocument{%
      \let\nxu@save@leq\leq
      \let\nxu@save@geq\geq
      \let\nxu@save@Re\Re
      \let\nxu@save@Im\Im
    }%
    \DeclareRobustCommand\bm[1]{{\symbfit{##1}}}%
    \DeclareRobustCommand\boldsymbol[1]{{\symbfit{##1}}}%
    \newcommand\square{\mdlgwhtsquare}%
    \newcommand\blacksquare{\mdlgblksquare}%
    \AtBeginDocument{%
      \renewcommand\checkmark{\ensuremath{\symbol{"2713}}}%
    }%
    \renewcommand\nxu@qed{\ensuremath{\QED}}%
  }%
}
\newcommand\nxu@set@math@font@stix{%
  \nxu@set@stix@names
  \setmathfont{\nxu@font@name@stix@math}[
    Extension    = .otf,
    Scale        = MatchLowercase,
    StylisticSet = \nxu@xits@integral@stylistic@set,
  ]%
  \setmathfont{\nxu@font@name@stix@math}[
    Extension    = .otf,
    Scale        = MatchLowercase,
    StylisticSet = 1,
    range        = {scr,bfscr},
  ]%
}
\newcommand\nxu@xits@integral@stylistic@set{%
  \ifnxu@integral@upright
    8%
  \fi
}
\newcommand\nxu@set@math@font@xits{%
  \nxu@set@xits@names
  \setmathfont{\nxu@font@name@xits@math}[
    Extension    = .otf,
    StylisticSet = \nxu@xits@integral@stylistic@set,
  ]%
  \setmathfont{\nxu@font@name@xits@math}[
    Extension    = .otf,
    StylisticSet = 1,
    range        = {cal,bfcal},
  ]%
}
\newcommand\nxu@libertinus@integral@stylistic@set{%
  \ifnxu@integral@slanted
    8%
  \fi
}
\newcommand\nxu@set@math@font@libertinus{%
  \nxu@set@libertinus@names
  \setmathfont{\nxu@font@name@libertinus@math}[
    Extension    = .otf,
    StylisticSet = \nxu@libertinus@integral@stylistic@set,
  ]%
}
\newcommand\nxu@newcm@integral@stylistic@set{%
  \ifnxu@integral@upright
    2%
  \fi
}
\newcommand\nxu@set@math@font@newcm{%
  \setmathfont{NewCMMath-Book}[
    Extension    = .otf,
    StylisticSet = \nxu@newcm@integral@stylistic@set,
  ]%
  \setmathfont{NewCMMath-Book}[
    Extension    = .otf,
    StylisticSet = 1,
    range        = {scr,bfscr},
  ]%
  \setmathrm{NewCM10}[
    Extension      = .otf,
    UprightFont    = *-Book,
    BoldFont       = *-Bold,
    ItalicFont     = *-BookItalic,
    BoldItalicFont = *-BoldItalic,
  ]%
  \setmathsf{NewCMSans10}[
    Extension         = .otf,
    UprightFont       = *-Book,
    BoldFont          = *-Bold,
    ItalicFont        = *-BookOblique,
    BoldItalicFont    = *-BoldOblique,
  ]%
  \setmathtt{NewCMMono10}[
    Extension           = .otf,
    UprightFont         = *-Book,
    ItalicFont          = *-BookItalic,
    BoldFont            = *-Bold,
    BoldItalicFont      = *-BoldOblique,
  ]%
}
\newcommand\nxu@set@math@font@lm{%
  \setmathfont{latinmodern-math}[Extension=.otf]%
  \setmathrm{lmroman10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic,
  ]%
  \setmathsf{lmsans10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-oblique,
    BoldItalicFont = *-boldoblique,
  ]%
  \setmathtt{lmmonolt10}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-oblique,
    BoldItalicFont = *-boldoblique,
  ]%
}
\newcommand\nxu@set@math@font@newtx{%
  \ifnxu@font@newtx\else
    \let\nxu@save@encodingdefault\encodingdefault
    \let\nxu@save@rmdefault\rmdefault
    \let\nxu@save@sfdefault\sfdefault
    \let\nxu@save@ttdefault\ttdefault
    \RequirePackage[T1]{fontenc}%
    \renewcommand{\rmdefault}{ntxtlf}%
    \renewcommand{\sfdefault}{qhv}%
    \renewcommand{\ttdefault}{ntxtt}%
  \fi
  \ifnxu@uppercase@greek@italic
    \PassOptionsToPackage{slantedGreek}{newtxmath}%
  \fi
  \ifnxu@integral@upright
    \PassOptionsToPackage{upint}{newtxmath}%
  \fi
  \RequirePackage{newtxmath}
  \let\nxu@save@leq\leq
  \let\nxu@save@geq\geq
  \ifnxu@leq@slanted
    \let\le\leqslant
    \let\ge\geqslant
    \let\leq\leqslant
    \let\geq\geqslant
  \fi
  \ifnxu@integral@limits@true
    \let\ilimits@\displaylimits
  \fi
  \let\nxu@save@partial\partial
  \ifnxu@partial@upright
    \let\partial\uppartial
  \fi
  \ifnxu@math@ellipsis@centered
    \DeclareRobustCommand\mathellipsis{\mathinner{\cdotp\cdotp\cdotp}}%
  \else
    \DeclareRobustCommand\mathellipsis{\mathinner{\ldotp\ldotp\ldotp}}%
  \fi
  \let\nxu@save@Re\Re
  \let\nxu@save@Im\Im
  \ifnxu@real@part@roman
    \def\Re{\operatorname{Re}}%
    \def\Im{\operatorname{Im}}%
  \fi
  \RequirePackage{bm}%
  \ifnxu@font@newtx\else
    \let\encodingdefault\nxu@save@encodingdefault
    \let\rmdefault\nxu@save@rmdefault
    \let\sfdefault\nxu@save@sfdefault
    \let\ttdefault\nxu@save@ttdefault
  \fi
  \DeclareRobustCommand\symup[1]{{\mathrm{##1}}}%
  \DeclareRobustCommand\symbf[1]{{\bm{##1}}}%
  \DeclareRobustCommand\symbfsf[1]{{\bm{\mathsf{##1}}}}%
  \let\increment\upDelta%
  \renewcommand\nxu@qed{\openbox}%
}
\newcommand\nxu@set@math@font{%
  \ifnxu@math@font@none\else
    \ifnxu@math@font@newtx
      \nxu@set@math@font@newtx
    \else
      \nxu@load@unimath
      \nxu@set@unimath@style
      \@nameuse{nxu@set@math@font@\nxu@math@font}%
    \fi
  \fi
}
\nxu@option@hook{math-font}{\g@addto@macro\nxu@setup@hook{\nxu@set@math@font}}
\newcommand\nxu@set@math@font@auto{%
  \ifnxu@math@font@auto
    \nxusetup{math-font=xits}%
  \fi
}
\AtBeginOfPackageFile*{siunitx}{\nxu@set@math@font@auto}
\AtEndPreamble{\nxu@set@math@font@auto}
\def\cleardoublepage{%
  \clearpage
  \if@twoside
    \ifnxu@output@print
      \ifodd\c@page
      \else
        \thispagestyle{empty}%
        \hbox{}%
        \newpage
        \if@twocolumn
          \hbox{}\newpage
        \fi
      \fi
    \fi
  \fi
}
\renewcommand\frontmatter{%
  \cleardoublepage
  \@mainmatterfalse
  \pagenumbering{Roman}%
  \pagestyle{plain}
}
\renewcommand\mainmatter{%
  \cleardoublepage
  \@mainmattertrue
  \pagenumbering{arabic}%
  \pagestyle{fancy}
}
\newif\ifnxu@backmatter
\renewcommand\backmatter{%
  \if@openright
    \cleardoublepage
  \else
    \clearpage
  \fi
  \@mainmatterfalse
  \nxu@backmattertrue
  \nxusetup{toc-depth = 0}%
}
\pagestyle{fancy}
\fancypagestyle{fancy}{%
  \fancyhf{}%
  \renewcommand\footrulewidth{0pt}%
    \renewcommand\headrulewidth{0.5bp}%
%    \newcommand{\makeheadrule}{%
%    	\makebox[0pt][l]{\rule[0.6\baselineskip]{\headwidth}{3.0bp}}%
%    	\rule[0.52\baselineskip]{\headwidth}{0.8bp}}
    \renewcommand{\headrule}{%
    	{\if@fancyplain\let\headrulewidth\plainheadrulewidth\fi
    		\makebox[0pt][l]{\rule[0.6\baselineskip]{\headwidth}{3.0bp}}%
    		\rule[0.52\baselineskip]{\headwidth}{0.8bp}
    			%\hrule\@height 3.0bp \@width\headwidth\vskip1pt%上面线为1pt粗
    			%\hrule\@height 0.8bp \@width\headwidth%下面0.5pt粗
    			%\vskip-2\headrulewidth\vskip-1pt
    		}}
    \fancyhead[L]{%
      \wuhao
      \ifnxu@main@language@chinese
        \ifnxu@degree@doctor
          宁夏大学博士学位论文
        \else
          \ifnxu@degree@master
            宁夏大学硕士学位论文
          \fi
        \fi
      \else
        \MakeUppercase{\leftmark}%
      \fi
      }%
    \fancyhead[R]{%
      \wuhao
      \ifnxu@main@language@chinese
        \leftmark
      \else
        \MakeUppercase{\leftmark}%
      \fi
      }%
    \fancyfoot[C]{\xiaowu \thepage}%
    \let\@mkboth\markboth
    \def\chaptermark##1{%
      \markboth{%
        \CTEXifname{%
          \CTEXthechapter
          \ifnxu@main@language@chinese
            \quad
          \else
            \space
          \fi
        }{}##1%
      }{}%
    }%
  \let\sectionmark\@gobble
}
\fancypagestyle{plain}{%
  \fancyhf{}%
  \renewcommand\footrulewidth{0pt}%
  \renewcommand\headrulewidth{0pt}%
  \renewcommand\headrule{}%
  \fancyfoot[C]{
    \xiaowu
    \thepage
  }
  %\fancyhead{}%
}
\pagestyle{fancy}
\def\ps@chapter{}
\ctexset{chapter/pagestyle = chapter}
\ctexset{%
  punct=quanjiao,
}
% \def\headrule{{\if@fancyplain\let\headrulewidth\plainheadrulewidth\fi%
		% \hrule\@height 1.0pt \@width\headwidth\vskip1pt%上面线为1pt粗
		% \hrule\@height 0.5pt\@width\headwidth%下面0.5pt粗
		% \vskip-2\headrulewidth\vskip-1pt}%两条线的距离1pt

\newcommand\nxu@set@indent{%
  \ifnxu@main@language@chinese
    \ctexset{autoindent=2}%
  \else
    \ctexset{autoindent=0.74cm}%
  \fi
}
\nxu@set@indent
\nxu@option@hook{degree}{\nxu@set@indent}
\nxu@option@hook{main-language}{\nxu@set@indent}
\urlstyle{same}
\g@addto@macro\UrlBreaks{%
  \do0\do1\do2\do3\do4\do5\do6\do7\do8\do9%
  \do\A\do\B\do\C\do\D\do\E\do\F\do\G\do\H\do\I\do\J\do\K\do\L\do\M
  \do\N\do\O\do\P\do\Q\do\R\do\S\do\T\do\U\do\V\do\W\do\X\do\Y\do\Z
  \do\a\do\b\do\c\do\d\do\e\do\f\do\g\do\h\do\i\do\j\do\k\do\l\do\m
  \do\n\do\o\do\p\do\q\do\r\do\s\do\t\do\u\do\v\do\w\do\x\do\y\do\z
}
\Urlmuskip=0mu plus 0.1mu
\partopsep=\z@skip
\def\@listi{\leftmargin\leftmargini
            \parsep \z@skip
            \topsep \z@skip
            \itemsep\z@skip}
\let\@listI\@listi
\@listi
\def\@listii {\leftmargin\leftmarginii
              \labelwidth\leftmarginii
              \advance\labelwidth-\labelsep
              \topsep    \z@skip
              \parsep    \z@skip
              \itemsep   \z@skip}
\def\@listiii{\leftmargin\leftmarginiii
              \labelwidth\leftmarginiii
              \advance\labelwidth-\labelsep
              \topsep    \z@skip
              \parsep    \z@skip
              \partopsep \z@skip
              \itemsep   \z@skip}
\setlist{nosep}
\interfootnotelinepenalty=10000
\newcommand\nxu@circled[1]{%
  \ifnum#1 >10\relax
    \nxu@warning{%
      Too many footnotes in this page.
      Keep footnote less than 10%
    }%
  \fi
  {\symbol{\the\numexpr#1+"245F\relax}}%
}
\renewcommand{\thefootnote}{\nxu@circled{\c@footnote}}
\renewcommand{\thempfootnote}{\nxu@circled{\c@mpfootnote}}
\def\footnoterule{\vskip-3\p@\hrule\@width0.3\textwidth\@height0.4\p@\vskip2.6\p@}
\footnotemargin=13.5bp
\long\def\@makefntext#1{%
  \begingroup
    % 序号取消上标
    \def\@makefnmark{\hbox{\normalfont\@thefnmark}}%
    \xiaowu
    \ifFN@hangfoot
      \bgroup
      \setbox\@tempboxa\hbox{%
        \ifdim\footnotemargin>\z@
          \hb@xt@\footnotemargin{\@makefnmark\hss}%
        \else
          \@makefnmark
        \fi
      }%
      \leftmargin\wd\@tempboxa
      \rightmargin\z@
      \linewidth \columnwidth
      \advance \linewidth -\leftmargin
      \parshape \@ne \leftmargin \linewidth
      % \footnotesize
      \xiaowu
      \@setpar{{\@@par}}%
      \leavevmode
      \llap{\box\@tempboxa}%
      \parskip\hangfootparskip\relax
      \parindent\hangfootparindent\relax
    \else
      \parindent1em%
      \noindent
      \ifdim\footnotemargin>\z@
        \hb@xt@ \footnotemargin{\hss\@makefnmark}%
      \else
        \ifdim\footnotemargin=\z@
          \llap{\@makefnmark}%
        \else
          \llap{\hb@xt@ -\footnotemargin{\@makefnmark\hss}}%
        \fi
      \fi
    \fi
    \footnotelayout#1%
    \ifFN@hangfoot
      \par\egroup
    \fi
  \endgroup
}
\allowdisplaybreaks[4]
\newcommand\nxu@put@parentheses[1]{%
  \ifnxu@language@chinese
    \unskip
    （#1）%
  \else
    (#1)%
  \fi
}
\def\tagform@#1{\maketag@@@{\nxu@put@parentheses{\ignorespaces#1\unskip\@@italiccorr}}}
\renewcommand{\eqref}[1]{%
  \textup{%
    \normalfont\nxu@put@parentheses{%
      \ignorespaces\ref{#1}\unskip\@@italiccorr
    }%
  }%
}
\def\fps@figure{htbp}
\def\fps@table{htbp}
\setlength{\floatsep}{12\p@ \@plus 2\p@ \@minus 2\p@}
\setlength{\textfloatsep}{12\p@ \@plus 2\p@ \@minus 2\p@}
\setlength{\intextsep}{12\p@ \@plus 2\p@ \@minus 2\p@}
\setlength{\@fptop}{0bp \@plus1.0fil}
\setlength{\@fpsep}{12bp \@plus2.0fil}
\setlength{\@fpbot}{0bp \@plus1.0fil}
\patchcmd{\@addtocurcol}%
  {\vskip \intextsep}%
  {\edef\save@first@penalty{\the\lastpenalty}\unpenalty
   \ifnum \lastpenalty = \@M  % hopefully the OR penalty
     \unpenalty
   \else
     \penalty \save@first@penalty \relax % put it back
   \fi
   \ifnum\outputpenalty <-\@Mii
     \addvspace\intextsep
     \vskip\parskip
   \else
     \addvspace\intextsep
   \fi}%
  {}{\nxu@patch@error{\@addtocurcol}}
\patchcmd{\@addtocurcol}%
  {\vskip\intextsep \ifnum\outputpenalty <-\@Mii \vskip -\parskip\fi}%
  {\ifnum\outputpenalty <-\@Mii
     \aftergroup\vskip\aftergroup\intextsep
     \aftergroup\nointerlineskip
   \else
     \vskip\intextsep
   \fi}%
  {}{\nxu@patch@error{\@addtocurcol}}
\patchcmd{\@getpen}{\@M}{\@Mi}
  {}{\nxu@patch@error{\@getpen}}
\renewcommand{\textfraction}{0.15}
\renewcommand{\topfraction}{0.85}
\renewcommand{\bottomfraction}{0.65}
\renewcommand{\floatpagefraction}{0.60}
\nxu@define@key{
  figure-number-separator = {
    name    = figure@number@separator,
    default = {-},
  },
  table-number-separator = {
    name    = table@number@separator,
    default = {-},
  },
  equation-number-separator = {
    name    = equation@number@separator,
    default = {-},
  },
  number-separator = {
    name    = number@separator,
    default = {.},
  },
}
\renewcommand\thefigure{%
  %\wuhao
  \ifnum\c@chapter>\z@
    \thechapter
    \nxu@figure@number@separator
  \fi
  \@arabic\c@figure
}
\renewcommand\thetable{%
  %\wuhao
  \ifnum\c@chapter>\z@
    \thechapter
    \nxu@table@number@separator
  \fi
  \@arabic\c@table
}
\renewcommand\theequation{%
  \xiaosi
  \ifnum\c@chapter>\z@
    \thechapter
    \nxu@equation@number@separator
  \fi
  \@arabic\c@equation
}
\newcommand\nxu@set@number@separator{%
  \let\nxu@figure@number@separator\nxu@number@separator
  \let\nxu@table@number@separator\nxu@number@separator
  \let\nxu@equation@number@separator\nxu@number@separator
}
\nxu@option@hook{number-separator}{\nxu@set@number@separator}
\DeclareCaptionFont{nxu}{%
  \ifnxu@language@chinese
    \fontsize{10.5bp}{10.5bp}\cusong\bfseries
  \else
    \fontsize{10.5bp}{10.5bp}\selectfont\bfseries
  \fi
}
\captionsetup{
  font           = nxu,
  labelsep       = quad,
  skip           = 6bp,
  figureposition = bottom,
  tableposition  = top,
}
\captionsetup[sub]{font=nxu}
\captionsetup[figure][bi-second]{name=Figure}%设置英文图开头为Figure
\captionsetup[table][bi-second]{name=Table}%设置英文表开头为Table
\renewcommand{\thesubfigure}{(\alph{subfigure})}
\renewcommand{\thesubtable}{(\alph{subtable})}
\newcommand\nxu@set@table@font{
  \ifnxu@language@chinese
    \def\nxu@table@font{%
      \fontsize{10.5bp}{10.5bp}\selectfont
      \renewcommand\arraystretch{1.42}%
    }%
  \else
    \def\nxu@table@font{%
      \fontsize{10.5bp}{10.5bp}\selectfont
      \renewcommand\arraystretch{1.47}%
    }%
  \fi
}
\nxu@set@table@font
\nxu@option@hook{language}{\nxu@set@table@font}
\patchcmd\@floatboxreset{%
  \normalsize
}{%
  \nxu@table@font
}{}{\nxu@patch@error{\@floatboxreset}}
\AtEndOfPackageFile*{longtable}{
  \AtBeginEnvironment{longtable}{%
    \nxu@table@font
  }
}
\heavyrulewidth=1.5bp
\lightrulewidth=1bp
\AtEndOfPackageFile*{threeparttable}{
  \g@addto@macro\TPT@defaults{\xiaowu}
}
\newcommand{\nxu@abstract@name}{摘\quad 要}
\newcommand{\nxu@abstract@name@en}{Abstract}
\ctexset{%
  chapter = {
    nameformat   = {},
    numberformat = {},
    titleformat  = {},
    fixskip      = true,
    afterindent  = true,
    lofskip      = 0pt,
    lotskip      = 0pt,
  },
  section = {
    afterindent  = true,
  },
  subsection = {
    afterindent  = true,
  },
  subsubsection = {
    afterindent  = true,
  },
  paragraph/afterindent = true,
  subparagraph/afterindent = true,
}
\newcommand\nxu@set@section@format{%
    \ctexset{%
      chapter = {
        beforeskip = 28bp,
        afterskip  = 26bp,
        %number     = \thechapter,
      },
      section = {
        beforeskip = 28bp,
        afterskip  = 12bp,
      },
      subsection = {
        beforeskip = 12bp,
        afterskip  = 6bp,
      },
      subsubsection = {
        beforeskip = 12bp,
        afterskip  = 12bp,
      },
    }%
    \ifnxu@main@language@chinese
      \ctexset{%
        chapter = {
          format      = \centering\sffamily\sanhao\bfseries,
          nameformat  = {},
          titleformat = {},
          name        = {第,章},
          aftername   = \quad,
          %number      = \zhnumber{\thechapter}
        },
        section = {
          format     = \sffamily\fontsize{14bp}{20bp}\selectfont\bfseries,
          aftername  = \quad,
        },
        subsection = {
          format     = \sffamily\fontsize{12bp}{20bp}\selectfont\bfseries,
          aftername  = \quad,
        },
        subsubsection = {
          format     = \sffamily\fontsize{12bp}{20bp}\selectfont\bfseries,
          aftername  = \quad,
        },
      }%
    \else
      \ctexset{%
        chapter = {
          format      = \centering\sffamily\bfseries\fontsize{16bp}{20bp}\selectfont\bfseries,
          nameformat  = \MakeUppercase,
          titleformat = \MakeUppercase,
          name        = \chaptername\space,
          aftername   = \space,
        },
        section = {
          format     = \sffamily\bfseries\fontsize{14bp}{20bp}\selectfont\bfseries,
          aftername  = \space,
        },
        subsection = {
          format     = \sffamily\bfseries\fontsize{13bp}{20bp}\selectfont\bfseries,
          aftername  = \space,
        },
        subsubsection = {
          format     = \sffamily\bfseries\fontsize{12bp}{20bp}\selectfont\bfseries,
          aftername  = \space,
        },
      }%
    \fi
}
\nxu@set@section@format
\nxu@option@hook{degree}{\nxu@set@section@format}
\nxu@option@hook{main-language}{\nxu@set@section@format}
\newcommand\nxu@english@number[1]{%
  \expandafter\ifcase\csname c@#1\endcsname
    Zero\or
    One\or
    Two\or
    Three\or
    Four\or
    Five\or
    Six\or
    Seven\or
    Eight\or
    Nine\or
    Ten\or
    Eleven\or
    Twelve\or
    Thirteen\or
    Fourteen\or
    Fifteen\or
    Sixteen\or
    Seventeen\or
    Eighteen\or
    Nineteen\or
    Twenty\or
    \nxu@error{You are genius}%
  \fi
}
\newcommand\nxu@pdfbookmark[2]{}
\newcommand\nxu@phantomsection{}
\NewDocumentCommand\nxu@chapter{s o m o}{%
  \IfBooleanF{#1}{%
    \nxu@error{You have to use the star form: \string\nxu@chapter*}%
  }%
  \if@openright\cleardoublepage\else\clearpage\fi%
  \IfValueTF{#2}{%
    \ifthenelse{\equal{#2}{}}{%
      \nxu@pdfbookmark{0}{#3}%
    }{%
      \nxu@phantomsection
      \addcontentsline{toc}{chapter}{#2}%
    }%
  }{%
    \nxu@phantomsection
    \addcontentsline{toc}{chapter}{#3}%
  }%
  \chapter*{#3}%
  \IfValueTF{#4}{%
    \ifthenelse{\equal{#4}{}}{%
      \@mkboth{}{}%
    }{%
      \@mkboth{#4}{#4}%
    }%
  }{%
    \@mkboth{#3}{#3}%
  }%
}
\setcounter{secnumdepth}{3}
\setcounter{tocdepth}{2}
\renewcommand\tableofcontents{%
  \ifnxu@degree@graduate
    \nxu@chapter*[]{\contentsname}%
  \else
    \nxu@chapter*[]{\contentsname}%
  \fi
  \markboth{目录}{}%
  \pagestyle{fancy}
  \@starttoc{toc}%
}
\nxu@define@key{
  toc-chapter-style = {
    name = toc@chapter@style,
    choices = {
      arial,
      times,
    },
    default = arial,
  },
}
\newcommand\nxu@leaders{\titlerule*[5bp]{$\cdot$}}
\newcommand\nxu@set@toc@format{%
  \contentsmargin{\z@}%
    \ifnxu@main@language@chinese
      \titlecontents{chapter}
        [\z@]{\mdseries \cusong \bfseries \sihao}
        {\contentspush{\thecontentslabel\quad}}{}
        {\nxu@leaders{\xiaosi \thecontentspage}}[\vspace{0.2cm}]%
      \titlecontents{section}
        [2em]{\cusong \bfseries \xiaosi}
        {\contentspush{\thecontentslabel\quad}}{}
        {\nxu@leaders\thecontentspage}[\vspace{0.2cm}]%
      \titlecontents{subsection}
        [4em]{\songti \xiaosi}
        {\contentspush{\thecontentslabel\quad}}{}
        {\nxu@leaders\thecontentspage}[\vspace{0.2cm}]%
    \else
      \titlecontents{chapter}
        [\z@]{\heiti}
        {\contentspush{\MakeUppercase{\thecontentslabel}\space}\MakeUppercase}{\MakeUppercase}
        {\rmfamily\nxu@leaders\thecontentspage}%
      \titlecontents{section}
        [1em]{}
        {\contentspush{\thecontentslabel\space}}{}
        {\nxu@leaders\thecontentspage}%
      \titlecontents{subsection}
        [2em]{}
        {\contentspush{\thecontentslabel\space}}{}
        {\nxu@leaders\thecontentspage}%
    \fi
}
\nxu@set@toc@format
\nxu@option@hook{degree}{\nxu@set@toc@format}
\nxu@option@hook{main-language}{\nxu@set@toc@format}
\nxu@define@key{
  secret-level = {
    name = secret@level,
  },
  secret-year = {
    name = secret@year,
  },
  title = {
    default = {标题},
  },
  title* = {
    default = {Title},
    name    = title@en,
  },
  author = {
    default = {姓名},
  },
  author* = {
  	default = {Name of author},
  	name    = author@en,
  },
  student-id = {
    name = student@id,
  },
  supervisor = {
    default = {导师姓名},
  },
  supervisor* = {
  	default = {Name of supervisor},
  	name    = supervisor@en,
  },
  associate-supervisor = {
    name = associate@supervisor,
  },
  co-supervisor = {
    name = co@supervisor,
  },
  % Reserved for compatibility
  joint-supervisor = {
    name = co@supervisor,
  },
  field = {
  	name = field,
  },
  code = {
    name = code,
  },
  degree-category = {
    default = {工学博士},
    name    = degree@category,
  },
  % 为了向后兼容
  degree-name = {
    name    = degree@category,
  },
}
\nxu@option@hook{degree-name}{%
  \nxu@warning{`degree-name' is deprecated. Use `degree-category' instead.}
}
\nxu@option@hook{degree-name*}{%
  \nxu@warning{`degree-name*' is deprecated. Use `degree-category*' instead.}
}
\nxu@define@key{
  department = {
    default = {土木与水利工程学院},
  },
  department* = {
  	default = {Department},
  	name = {department@en}
  },
  discipline = {
    % default = {土木与水利工程学院},
  },
}
% \nxu@option@hook{discipline}{%
%   \ifnxu@degree@type@professional
%     \nxu@warning{`discipline' for professional degree is deprecated. Use `professional-field' instead.}
%     \let\nxu@professional@field\nxu@discipline
%     \let\nxu@discipline\@empty
%   \fi
% }
% \nxu@option@hook{discipline*}{%
%   \ifnxu@degree@type@professional
%     \nxu@warning{`discipline*' for professional degree is deprecated. Use `professional-field*' instead.}
%     \let\nxu@professional@field@en\nxu@discipline@en
%     \let\nxu@discipline@en\@empty
%   \fi
% }
\nxu@define@key{
  professional-field = {
    name    = professional@field,
  },
  engineering-field = {
    name    = engineering@field,
  },
  date = {
    default = {\the\year-\two@digits{\month}-\two@digits{\day}},
  },
  clc,
  udc,
  id,
  discipline-level-1 = {
    default = {一级学科名称},
    name    = discipline@level@i,
  },
  discipline-level-2 = {
    default = {二级学科名称},
    name    = discipline@level@ii,
  },
  start-date = {
    name    = start@date,
    default = {\the\year-\two@digits{\month}-\two@digits{\day}},
  },
  end-date = {
    name    = end@date,
    default = {\the\year-\two@digits{\month}-\two@digits{\day}},
  },
  include-spine = {
    name = include@spine,
    choices = {
      false,
      true,
    },
    default = false,
  },
  blind-review = {
	name = blind@review,
	choices = {
	  false,
	  true,
	},
	default = false,
  },
}
\newcommand\nxu@format@date[2]{%
  \edef\nxu@@date{#2}%
  \def\nxu@@process@date##1-##2-##3\@nil{%
    #1{##1}{##2}{##3}%
  }%
  \expandafter\nxu@@process@date\nxu@@date\@nil
}
\newcommand\nxu@date@zh@digit[3]{#1 年 \number#2 月 \number#3 日}
\newcommand\nxu@date@zh@digit@short[3]{#1 年 \number#2 月}
\newcommand\nxu@date@zh@short[3]{\zhdigits{#1}年\zhnumber{#2}月}
\newcommand\nxu@date@month[1]{%
  \ifcase\number#1\or
    January\or February\or March\or April\or May\or June\or
    July\or August\or September\or October\or November\or December%
  \fi
}
\newcommand\nxu@date@en@short[3]{\nxu@date@month{#2} #1}
\newcommand\nxu@underline[2][6em]{\hskip1pt\underline{\hb@xt@ #1{\hss#2\hss}}\hskip3pt}
\newcommand\nxu@uline[2][6em]{\uline{\hb@xt@ #1{\hss#2\hss}}}
\newcommand\nxu@fixed@box[2]{%
  \begingroup
    \ifLuaTeX
      \ltjsetparameter{kanjiskip = {0pt plus 2filll minus 1filll}}%
    \else
      \renewcommand\CJKglue{\hspace{0pt plus 2filll minus 1filll}}%
    \fi
    \makebox[#1][l]{#2}%
  \endgroup
}
\newbox\nxu@stretch@box
\newcommand\nxu@stretch[2]{%
  \sbox\nxu@stretch@box{#2}%
  \ifdim \wd\nxu@stretch@box < #1\relax
    \begingroup
      \ifLuaTeX
        \ltjsetparameter{kanjiskip = {0pt plus 2filll}}%
      \else
        \renewcommand\CJKglue{\hspace{0pt plus 2filll}}%
      \fi
      \makebox[#1][l]{#2}%
    \endgroup
  \else
    \box\nxu@stretch@box
  \fi
}
\newbox\nxu@pad@box
\newcommand\nxu@pad[2]{%
  \sbox\nxu@pad@box{#2}%
  \ifdim \wd\nxu@pad@box < #1\relax
    \makebox[#1]{\box\nxu@pad@box}%
  \else
    \box\nxu@pad@box
  \fi
}
\newcounter{nxu@csl@count}
\newcommand\nxu@name@title@process[1]{%
  \ifcase\c@nxu@csl@count  % == 0
    \gdef\nxu@@name{#1}%
  \or  % == 1
    \gdef\nxu@@title{#1}%
  \fi
  \stepcounter{nxu@csl@count}%
}
\newcommand\nxu@name@title@format[2]{%
  %\nxu@pad{3em}{\nxu@stretch{3em}{#1}}%
  \makebox[4.5em][l]{\box\nxu@pad@box{#1}}
  %#2
  \nxu@stretch{1em}{#2}%
}
\newcommand\nxu@name@title[1]{%
  \setcounter{nxu@csl@count}{0}%
  \gdef\nxu@@name{}%
  \gdef\nxu@@title{}%
  \expandafter\comma@parse\expandafter{#1}{\nxu@name@title@process}%
  \nxu@name@title@format{\nxu@@name}{\nxu@@title}%
}
\renewcommand\maketitle{%
  \cleardoublepage
  \pagenumbering{Alph}%
  \nxu@pdfbookmark{-1}{\nxu@title}%
  \nxu@titlepage
  \ifnxu@include@spine@true
    \spine
  \fi
  \ifnxu@degree@graduate
    \ifnxu@thesis@type@thesis
      \cleardoublepage
      \nxu@titlepage@en
    \fi
  \fi
  \clearpage
}
\newcommand\nxu@titlepage{%
  \nxusetup{language = chinese}%
  \nxu@titlepage@thesis
  \nxu@reset@main@language
}
\newCJKfontfamily{\cusong}[AutoFakeBold={2.17}]{SimSun}
\newcommand\nxu@titlepage@thesis{%
  \thispagestyle{empty}%
  % \null\vskip 8.1pt%
  \begingroup
    \centering
    \begingroup
      \fontsize{10.5bp}{10.5bp}\selectfont
      \nxu@titlepage@topinfo\par
    \endgroup
    \vskip 1.7cm%
    \nxu@titlepage@name
    \vskip 0.68cm
    \nxu@title@page@degree@category\par
    \ifnxu@blind@review@false
      \nxu@title@page@degree@field\par
    \fi
    \vskip 0.6cm
    \begingroup
      \cusong\bfseries\fontsize{22bp}{30bp}\selectfont
      \nxu@title\par
    \endgroup
    %\vskip 8pt
    %\vskip 24.1pt%
    \vfill
    \begingroup
      \fontsize{14bp}{21bp}\songti
      \nxu@titlepage@info\par
    \endgroup
    \vskip 42pt%
    \nxu@titlepage@date
    \vskip 20pt%
    %\fi
  \endgroup
  \clearpage
  \restoregeometry
}
\newcommand\nxu@set@student@id{%
  \ifnxu@thesis@type@proposal
    \ifx\nxu@student@id\@empty
      \nxusetup{student-id=2000310000}%
    \fi
  \fi
}
\nxu@set@student@id
\nxu@option@hook{thesis-type}{\nxu@set@student@id}
\newcommand\nxu@titlepage@name{
  \begin{center}
  	\includegraphics[width=10.3cm]{nxu-name.pdf}
  \end{center}
}
\newcommand\nxu@titlepage@topinfo{
	\nxu@titlepage@topinfo@tabular{3em}{4em}{1em}{
	  \nxu@topinfo@iteml{分类号}{\nxu@clc}
    \ifnxu@blind@review@true
      \empty
    \else
      \ifnxu@blind@review@false
	      \nxu@topinfo@iteml{密级}{\nxu@secret@level}
      \fi
    \fi
	}{
	  \nxu@topinfo@itemr{单位代码}{\nxu@code}
	  \nxu@topinfo@itemr{}{}
	}\par
}
\newcommand\nxu@titlepage@topinfo@tabular[5]{%
	\def\nxu@topinfo@iteml##1##2{%
	  \nxu@pad{#1}{\nxu@fixed@box{#1}{##1}}%
	  \nxu@pad{#3}{：}%
	  \makebox[6em][l]{ ##2 }\\[3bp]
	}%
	\def\nxu@topinfo@itemr##1##2{%
		\nxu@pad{#2}{\nxu@fixed@box{#2}{##1}}%
	    \ifx##2\@empty\else
	      \nxu@pad{#3}{：}%
	    \fi
	    \makebox[3em][l]{ ##2 }\\[3bp]
	}%
	\begin{tabular}{l}%
		#4%
	\end{tabular}%
	\hfill
	\begin{tabular}{l}%
		#5%
	\end{tabular}%
}
\newcommand\nxu@title@page@degree@category{%
  \begingroup
    \fontsize{22bp}{24bp}\selectfont
    \ifLuaTeX
      \fontspec{\CJK@family}%
      \ltjsetparameter{kanjiskip = {1bp}}%
    \else
      \CJKfamily+{}%
      \renewcommand\CJKglue{\hspace{1bp}}%
    \fi
    \ifnxu@thesis@type@thesis
      \ifnxu@blind@review@true
        \ifnxu@degree@master
          \ifnxu@degree@type@academic
            硕士学位论文
          \else
            \ifnxu@degree@type@professional
              专业硕士学位论文
            \fi
          \fi
        \else
          \ifnxu@degree@doctor
            博士学位论文
          \fi
        \fi
      \else
        \ifnxu@blind@review@false
          \ifnxu@degree@master
            硕士学位论文
          \else
            \ifnxu@degree@doctor
              博士学位论文
            \fi
          \fi
        \fi
      \fi
    \fi
    \par
  \endgroup
}
\newcommand\nxu@title@page@degree@field{%
	\begingroup
		\fontsize{12bp}{18bp}\selectfont
		\ifLuaTeX
			\fontspec{\CJK@family}%
			\ltjsetparameter{kanjiskip = {1bp}}%
		\else
			\CJKfamily+{}%
			\renewcommand\CJKglue{\hspace{1bp}}%
		\fi
		\ifnxu@thesis@type@thesis
			\ifnxu@degree@type@academic
				（学术学位）
			\else
				\ifnxu@degree@type@professional
					（专业学位）
			\fi
		\fi
	\par
	\endgroup
}
\newcommand\nxu@titlepage@info{%
  \ifnxu@blind@review@true
	  \nxu@titlepage@info@tabular{0.0cm}{2.54cm}{2.44cm}{0.60cm}{%
	  	\nxu@info@item{学号}{}{\sihao\nxu@student@id}%
	  	\nxu@info@item{学院}{}{\nxu@department}%
	  	\nxu@info@item{专业}{}{\nxu@discipline}%
	  	\nxu@info@item{研究方向}{}{\nxu@field}%
	  	\nxu@info@item{申请学位}{}{\nxu@degree@category}%
	  }\par
  \else
	  \ifnxu@blind@review@false
		  \nxu@titlepage@info@tabular{0.0cm}{2.54cm}{2.44cm}{0.60cm}{%
		  	\nxu@info@item{姓名}{}{\nxu@author}%
		  	\nxu@info@item{学号}{}{\sihao\nxu@student@id}%
		  	\nxu@info@item{指导教师}{\nxu@name@title}{\nxu@supervisor}%
		  	\nxu@info@item{合作导师}{\nxu@name@title}{\nxu@co@supervisor}%
		  	\ifnxu@degree@type@academic
		  		\nxu@info@item{学院}{}{\nxu@department}%
		  		\nxu@info@item{专业}{}{\nxu@discipline}%
		  	\else
		  		\nxu@info@item{培养单位}{}{\nxu@department}%
		  		\nxu@info@item{专业领域}{}{\nxu@discipline}%
		  	\fi
		  	\nxu@info@item{研究方向}{}{\nxu@field}%
		    \nxu@info@item{申请学位}{}{\nxu@degree@category}%
		  }\par
	 \fi
  \fi
}
\newcommand\nxu@titlepage@info@tabular[5]{%
  \def\nxu@info@item##1##2##3{%
    \ifx##3\@empty\else
      \nxu@pad{#2}{\nxu@fixed@box{#3}{##1}}%
      \nxu@pad{#4}{：}%
      \uline{ \nxu@pad{18em}{\hfill ##2{##3} }}\\[12bp]
    \fi
  }%
  \hspace{#1}%
  \begin{tabular}{l}%
    \renewcommand\arraystretch{1}%
    #5%
  \end{tabular}%
}
\newcommand\nxu@titlepage@date{%
	\begingroup
		\sihao
		\ifLuaTeX
			\ltjsetparameter{kanjiskip = {1bp}}%
		\else
			\renewcommand\CJKglue{\hspace{1bp}}%
		\fi
		\nxu@format@date{\nxu@date@zh@digit@short}{\nxu@date}\par
	\endgroup
}
\newcommand{\nxu@titlepage@en}{%
	\thispagestyle{empty}%
	\nxusetup{language = english}%
	\begingroup
		\centering
		\null\vskip 0cm
		\begingroup
			\sffamily\bfseries\fontsize{16bp}{30bp}\selectfont
			\nxu@titlepage@en@degree\par
		\endgroup
		\vskip 3.5cm
		\nxu@titlepage@en@title
		\vfill
    \ifnxu@blind@review@true
      \empty
    \else
      \ifnxu@blind@review@true
        \begingroup
          \fontsize{16bp}{24bp}\selectfont
          \nxu@titlepage@en@info
        \endgroup
      \fi
    \fi
		\vskip 5.0cm
		\nxu@titlepage@en@address
	\endgroup
	\nxu@reset@main@language
	\clearpage
	\restoregeometry
}
\newcommand\nxu@titlepage@en@degree{%
	A Dissertation Submitted to Ningxia University\par
	for the Degree of
	\ifnxu@thesis@type@thesis
		\ifnxu@degree@master
			Master
		\else
			\ifnxu@degree@doctor
				Doctor
		\fi
	\fi
	\par
}
\newcommand\nxu@titlepage@en@title{%
	\begingroup
		\sffamily\bfseries\fontsize{18bp}{32bp}\selectfont
		\nxu@title@en\par
	\endgroup
}
\newcommand\nxu@titlepage@en@info{%
	\nxu@titlepage@en@info@tabular{3.6em}{0.5em}{8em}{
		\nxu@titlepage@en@info@item{Author}{\nxu@author@en}
		\nxu@titlepage@en@info@item{Supervisor}{\nxu@supervisor@en}
	}\par
}
\newcommand\nxu@titlepage@en@info@tabular[4]{%
	\def\nxu@titlepage@en@info@item##1##2{%
		\nxu@pad{#1}{\bfseries \makebox[#1][r]{##1} }%
		\nxu@pad{#2}{\bfseries \makebox[#2][l]{:} }%
		\nxu@pad{#3}{\makebox[#3][l]{##2} }\\[8bp]
	}%
	\begin{tabular}{l}%
		#4%
	\end{tabular}%
}
\newcommand\nxu@titlepage@en@address{%
	\fontsize{14bp}{30bp}\selectfont
	\begingroup
		\nxu@department@en\par
 		Ningxia University\par
		Yinchuan, P.R. China\par
		\nxu@format@date{\nxu@date@en@short}{\nxu@date}\par
	\endgroup
}
\newcommand\copyrightpage[1][]{%
  \cleardoublepage
    \def\nxu@@tmp{#1}
    \ifx\nxu@@tmp\@empty
      \nxusetup{language=chinese}%
      \thispagestyle{empty}%
      \nxu@copyright@page@graduate
      \nxu@reset@main@language
    \else
      \thispagestyle{empty}%
      \nxu@pdfbookmark{0}{关于学位论文使用授权的说明}%
      \nxu@phantomsection
      \kv@define@key{nxu@copyright}{file}{\includepdf{\kv@value}}%
      \kv@set@family@handler{nxu@copyright}{%
        \ifx\kv@value\relax
          \includepdf{\kv@key}%
        \else
          \kv@handled@false
        \fi
      }%
      \kvsetkeys{nxu@copyright}{#1}%
    \fi
}
\newcommand{\nxu@authorization@frontdate}{%
  日\hspace{2em} 期：}
\newcommand\nxu@copyright@page@graduate{%
  \null\vskip 5bp%
  \begingroup
	\begin{center}
		\sffamily\fontsize{16bp}{32bp}\selectfont\bfseries
		学位论文原创性声明
	\end{center}
  \endgroup
  \vskip 14bp%
  \begingroup
	  \fontsize{14bp}{20bp}\selectfont
	  \hspace{2em}本人郑重声明：所呈交的学位论文，是本人在导师的指导下，独立进行研究所取得的成果。除文中已经注明引用的内容外，本学位论文不包含其他个人或集体已发表或撰写过的科研成果。对本文的研究做出贡献的个人和集体，均已在文中以明确方式标明。本声明的法律责任由本人承担。\par
  \endgroup
  \vskip 30bp
  \begingroup
  	\fontsize{14bp}{20bp}\selectfont
  	论文作者签名：\hspace{8em}签字日期：\hspace{3em}年\hspace{1.5em}月\hspace{1.5em}日\par
  \endgroup
  \vskip 3.80cm 
  \begingroup
    \begin{center}
    	\sffamily\fontsize{16bp}{32bp}\selectfont\bfseries
    	学位论文版权使用授权书
    \end{center}
  \endgroup
  \vskip 16bp%
  \begingroup
    \fontsize{14bp}{20bp}\selectfont
    \hspace{2em}本学位论文作者和指导教师完全了解宁夏大学有关保留、使用学位论文的规定：学校有权保留并向国家有关部门或机构送交学位论文的复印件和电子版；允许本学位论文被查阅和借阅；学校可以将本学位论文的全部或部分内容编入有关数据库进行检索，可以采用影印、缩印或其他复制手段保存和汇编本学位论文。\par
    \vskip 14bp
    本学位论文属于：保密$\boxempty$ \hspace{2em}在\uline{\hspace{2em}}年解密后适用本授权书\par
    \vskip 14bp
    \hspace{8em}不保密$\boxempty$
  \endgroup
  \vskip 30bp
  \begingroup
  \fontsize{14bp}{20bp}\selectfont
  论文作者签名：\hspace{8.4em}导师签名：\par
  \vskip 28bp
  签字日期：\hspace{3em}年\hspace{1.2em}月\hspace{1.2em}日\hspace{2em}签字日期：\hspace{3em}年\hspace{1.2em}月\hspace{1.2em}日\par
  \endgroup
}
\nxu@define@key{
  keywords,
  keywords* = {
    name = keywords@en,
  },
}
\newcommand\nxu@clist@use[2]{%
  \def\nxu@@tmp{}%
  \def\nxu@clist@processor##1{%
    \ifx\nxu@@tmp\@empty
      \def\nxu@@tmp{#2}%
    \else
      #2%
    \fi
    ##1%
  }%
  \expandafter\comma@parse\expandafter{#1}{\nxu@clist@processor}%
}
\newenvironment{abstract}{%
  \thispagestyle{empty}
  \nxusetup{language = chinese}%
  \ifnxu@degree@graduate
    \begingroup
      \ifnxu@main@language@english
        \ctexset{%
          chapter/format = \centering\sffamily\fontsize{16bp}{20bp}\selectfont,
        }%
      \fi
      \nxu@chapter*{\nxu@abstract@name}%
    \endgroup
  \else
    \nxu@chapter*[]{\nxu@abstract@name}%
  \fi
}{%
  \par
  \null\par
  \noindent
  \textbf{关键词：}%
  \nxu@clist@use{\nxu@keywords}{，}%
  \gdef\nxu@keywords{}%
  \nxu@reset@main@language % switch back to main language
}
\newenvironment{abstract*}{%
  \nxusetup{language = english}%
  \ifnxu@degree@graduate
    \nxu@chapter*[]{\bfseries \nxu@abstract@name@en}%
    \addcontentsline{toc}{chapter}{\nxu@abstract@name@en}%
  \else
    \nxu@chapter*[]{\nxu@abstract@name@en}%
  \fi
}{%
  \par
  \null\par
  \noindent
  \textbf{Key words:}\space
  \nxu@clist@use{\nxu@keywords@en}{, }%
  \ifnxu@degree@graduate
    \vspace*{\stretch{1}}%
  \fi
  \nxu@reset@main@language % switch back to main language
}
\newenvironment{denotation}[1][2.5cm]{%
  \nxu@chapter*{\nxu@denotation@name}%
  \vskip-30bp\xiaosi[1.6]\begin{nxu@denotation}[labelwidth=#1]
}{%
  \end{nxu@denotation}
}
\newlist{nxu@denotation}{description}{1}
\setlist[nxu@denotation]{%
  nosep,
  font=\normalfont,
  align=left,
  leftmargin=!, % sum of the following 3 lengths
  labelindent=0pt,
  labelwidth=2.5cm,
  labelsep*=0.5cm,
  itemindent=0pt,
}
\newcommand{\nxu@signature}{签\hspace{1em}名：}
\newcommand{\nxu@backdate}{日\hspace{1em}期：}
\newenvironment{acknowledgements}{%
  \@mainmatterfalse
  \nxu@end@appendix@ref@section
  \nxu@chapter*{\nxu@acknowledgements@name}%
  \markboth{致谢}{}%
}{%
}
\let\acknowledgement\acknowledgements
\let\endacknowledgement\endacknowledgements
\def\nxu@listof#1{% #1: float type
  \setcounter{tocdepth}{2} % restore tocdepth in case being modified
  \@ifstar
    {\nxu@chapter*[]{\csname list#1name\endcsname}\@starttoc{\csname ext@#1\endcsname}}
    {\nxu@chapter*{\csname list#1name\endcsname}\@starttoc{\csname ext@#1\endcsname}}%
}
\renewcommand\listoffigures{%
  \nxu@listof{figure}%
}
\titlecontents{figure}
  [\z@]{}
  {\contentspush{\figurename~\thecontentslabel\quad}}{}
  {\nobreak\nxu@leaders\nobreak\hfil\thecontentspage}
\renewcommand\listoftables{%
  \nxu@listof{table}%
}
\titlecontents{table}
  [\z@]{}
  {\contentspush{\tablename~\thecontentslabel\quad}}{}
  {\nxu@leaders\thecontentspage}
\newcommand\listoffiguresandtables{%
  \nxu@chapter*{\nxu@list@figure@table@name}%
  \@starttoc{lof}%
  \par
  \null\par
  \@starttoc{lot}%
}
\def\ext@equation{loe}
\def\equcaption#1{%
  \addcontentsline{\ext@equation}{equation}%
                  {\protect\numberline{#1}}}
\newcommand\listofequations{\nxu@listof{equation}}
\titlecontents{equation}
  [0pt]{\addvspace{6bp}}
  {\nxu@equation@name~\thecontentslabel}{}
  {\nobreak\nxu@leaders\nobreak\thecontentspage}
\contentsuse{equation}{loe}
\nxu@define@key{
  cite-style = {
    name = cite@style,
    choices = {
      super,
      inline,
      author-year,
    }
  }
}
\def\bibliographystyle#1{%
  \gdef\bu@bibstyle{#1}%
  \ifx\@begindocumenthook\@undefined\else
    \expandafter\AtBeginDocument
  \fi
    {\if@filesw
       \immediate\write\@auxout{\string\bibstyle{#1}}%
       \immediate\write\@auxout{\string\gdef\string\bu@bibstyle{#1}}%
     \fi}%
}
\def\bibliography#1{%
  \if@filesw
    \immediate\write\@auxout{\string\bibdata{\zap@space#1 \@empty}}%
    \immediate\write\@auxout{\string\gdef\string\bu@bibdata{#1}}%
  \fi
  \gdef\bu@bibdata{#1}%
  \@input@{\jobname.bbl}}
\PassOptionsToPackage{compress}{natbib}
\AtEndOfPackageFile*{natbib}{
  \DeclareRobustCommand\inlinecite{\@inlinecite}
  \def\@inlinecite#1{\begingroup\let\@cite\NAT@citenum\citep{#1}\endgroup}
  \let\onlinecite\inlinecite
  \newcommand\bibstyle@super{%
    \bibpunct{[}{]}{,}{s}{,}{\textsuperscript{,}}}
  \newcommand\bibstyle@inline{%
    \bibpunct{[}{]}{,}{n}{,}{,}}
  \@namedef{bibstyle@author-year}{%
    \bibpunct{(}{)}{;}{a}{,}{,}}
  \nxu@option@hook{cite-style}{\@nameuse{bibstyle@\nxu@cite@style}}
  \@namedef{bibstyle@nxuthesis-numeric}{\citestyle{super}}
  \@namedef{bibstyle@nxuthesis-author-year}{\citestyle{author-year}}
  \@namedef{bibstyle@cell}{\citestyle{author-year}}
  %\@namedef{bibstyle@nxuthesis-bachelor}{\citestyle{super}}
  \renewcommand\NAT@citesuper[3]{%
    \ifNAT@swa
      \if*#2*\else
        #2\NAT@spacechar
      \fi
      % \unskip\kern\p@\textsuperscript{\NAT@@open#1\NAT@@close}%
      %  \if*#3*\else\NAT@spacechar#3\fi\else #1\fi\endgroup}
      \unskip\kern\p@
      \textsuperscript{%
        \NAT@@open#1\NAT@@close
        \if*#3*\else#3\fi
      }%
      \kern\p@
    \else
      #1%
    \fi
    \endgroup
  }
  \renewcommand\NAT@citenum[3]{%
    \ifNAT@swa
      \NAT@@open
      \if*#2*\else
        #2\NAT@spacechar
      \fi
      % #1\if*#3*\else\NAT@cmt#3\fi\NAT@@close
      #1\NAT@@close
      \if*#3*\else
        \textsuperscript{#3}%
      \fi
    \else
      #1%
    \fi
    \endgroup
  }
  \def\NAT@citexnum[#1][#2]#3{%
    \NAT@reset@parser
    \NAT@sort@cites{#3}%
    \NAT@reset@citea
    \@cite{\def\NAT@num{-1}\let\NAT@last@yr\relax\let\NAT@nm\@empty
      \@for\@citeb:=\NAT@cite@list\do
      {\@safe@activestrue
      \edef\@citeb{\expandafter\@firstofone\@citeb\@empty}%
      \@safe@activesfalse
      \@ifundefined{b@\@citeb\@extra@b@citeb}{%
        {\reset@font\bfseries?}
          \NAT@citeundefined\PackageWarning{natbib}%
        {Citation `\@citeb' on page \thepage \space undefined}}%
      {\let\NAT@last@num\NAT@num\let\NAT@last@nm\NAT@nm
        \NAT@parse{\@citeb}%
        \ifNAT@longnames\@ifundefined{bv@\@citeb\@extra@b@citeb}{%
          \let\NAT@name=\NAT@all@names
          \global\@namedef{bv@\@citeb\@extra@b@citeb}{}}{}%
        \fi
        \ifNAT@full\let\NAT@nm\NAT@all@names\else
          \let\NAT@nm\NAT@name\fi
        \ifNAT@swa
        \@ifnum{\NAT@ctype>\@ne}{%
          \@citea
          \NAT@hyper@{\@ifnum{\NAT@ctype=\tw@}{\NAT@test{\NAT@ctype}}{\NAT@alias}}%
        }{%
          \@ifnum{\NAT@cmprs>\z@}{%
          \NAT@ifcat@num\NAT@num
            {\let\NAT@nm=\NAT@num}%
            {\def\NAT@nm{-2}}%
          \NAT@ifcat@num\NAT@last@num
            {\@tempcnta=\NAT@last@num\relax}%
            {\@tempcnta\m@ne}%
          \@ifnum{\NAT@nm=\@tempcnta}{%
            \@ifnum{\NAT@merge>\@ne}{}{\NAT@last@yr@mbox}%
          }{%
            \advance\@tempcnta by\@ne
            \@ifnum{\NAT@nm=\@tempcnta}{%
              % \ifx\NAT@last@yr\relax
              %   \def@NAT@last@yr{\@citea}%
              % \else
              %   \def@NAT@last@yr{--\NAT@penalty}%
              % \fi
              \def@NAT@last@yr{-\NAT@penalty}%
            }{%
              \NAT@last@yr@mbox
            }%
          }%
          }{%
          \@tempswatrue
          \@ifnum{\NAT@merge>\@ne}{\@ifnum{\NAT@last@num=\NAT@num\relax}{\@tempswafalse}{}}{}%
          \if@tempswa\NAT@citea@mbox\fi
          }%
        }%
        \NAT@def@citea
        \else
          \ifcase\NAT@ctype
            \ifx\NAT@last@nm\NAT@nm \NAT@yrsep\NAT@penalty\NAT@space\else
              \@citea \NAT@test{\@ne}\NAT@spacechar\NAT@mbox{\NAT@super@kern\NAT@@open}%
            \fi
            \if*#1*\else#1\NAT@spacechar\fi
            \NAT@mbox{\NAT@hyper@{{\citenumfont{\NAT@num}}}}%
            \NAT@def@citea@box
          \or
            \NAT@hyper@citea@space{\NAT@test{\NAT@ctype}}%
          \or
            \NAT@hyper@citea@space{\NAT@test{\NAT@ctype}}%
          \or
            \NAT@hyper@citea@space\NAT@alias
          \fi
        \fi
      }%
      }%
        \@ifnum{\NAT@cmprs>\z@}{\NAT@last@yr}{}%
        \ifNAT@swa\else
          % \@ifnum{\NAT@ctype=\z@}{%
          %   \if*#2*\else\NAT@cmt#2\fi
          % }{}%
          \NAT@mbox{\NAT@@close}%
          \@ifnum{\NAT@ctype=\z@}{%
            \if*#2*\else
              \textsuperscript{#2}%
            \fi
          }{}%
          \NAT@super@kern
        \fi
    }{#1}{#2}%
  }%
  \renewcommand\NAT@cite%
      [3]{\ifNAT@swa\NAT@@open\if*#2*\else#2\NAT@spacechar\fi
          % #1\if*#3*\else\NAT@cmt#3\fi\NAT@@close\else#1\fi\endgroup}
          #1\NAT@@close\if*#3*\else\textsuperscript{#3}\fi\else#1\fi\endgroup}
  \def\NAT@citex%
    [#1][#2]#3{%
    \NAT@reset@parser
    \NAT@sort@cites{#3}%
    \NAT@reset@citea
    \@cite{\let\NAT@nm\@empty\let\NAT@year\@empty
      \@for\@citeb:=\NAT@cite@list\do
      {\@safe@activestrue
      \edef\@citeb{\expandafter\@firstofone\@citeb\@empty}%
      \@safe@activesfalse
      \@ifundefined{b@\@citeb\@extra@b@citeb}{\@citea%
        {\reset@font\bfseries ?}\NAT@citeundefined
                  \PackageWarning{natbib}%
        {Citation `\@citeb' on page \thepage \space undefined}\def\NAT@date{}}%
      {\let\NAT@last@nm=\NAT@nm\let\NAT@last@yr=\NAT@year
        \NAT@parse{\@citeb}%
        \ifNAT@longnames\@ifundefined{bv@\@citeb\@extra@b@citeb}{%
          \let\NAT@name=\NAT@all@names
          \global\@namedef{bv@\@citeb\@extra@b@citeb}{}}{}%
        \fi
      \ifNAT@full\let\NAT@nm\NAT@all@names\else
        \let\NAT@nm\NAT@name\fi
      \ifNAT@swa\ifcase\NAT@ctype
        \if\relax\NAT@date\relax
          \@citea\NAT@hyper@{\NAT@nmfmt{\NAT@nm}\NAT@date}%
        \else
          \ifx\NAT@last@nm\NAT@nm\NAT@yrsep
              \ifx\NAT@last@yr\NAT@year
                \def\NAT@temp{{?}}%
                \ifx\NAT@temp\NAT@exlab\PackageWarningNoLine{natbib}%
                {Multiple citation on page \thepage: same authors and
                year\MessageBreak without distinguishing extra
                letter,\MessageBreak appears as question mark}\fi
                \NAT@hyper@{\NAT@exlab}%
              \else\unskip\NAT@spacechar
                \NAT@hyper@{\NAT@date}%
              \fi
          \else
            \@citea\NAT@hyper@{%
              \NAT@nmfmt{\NAT@nm}%
              \hyper@natlinkbreak{%
                \NAT@aysep\NAT@spacechar}{\@citeb\@extra@b@citeb
              }%
              \NAT@date
            }%
          \fi
        \fi
      \or\@citea\NAT@hyper@{\NAT@nmfmt{\NAT@nm}}%
      \or\@citea\NAT@hyper@{\NAT@date}%
      \or\@citea\NAT@hyper@{\NAT@alias}%
      \fi \NAT@def@citea
      \else
        \ifcase\NAT@ctype
          \if\relax\NAT@date\relax
            \@citea\NAT@hyper@{\NAT@nmfmt{\NAT@nm}}%
          \else
          \ifx\NAT@last@nm\NAT@nm\NAT@yrsep
              \ifx\NAT@last@yr\NAT@year
                \def\NAT@temp{{?}}%
                \ifx\NAT@temp\NAT@exlab\PackageWarningNoLine{natbib}%
                {Multiple citation on page \thepage: same authors and
                year\MessageBreak without distinguishing extra
                letter,\MessageBreak appears as question mark}\fi
                \NAT@hyper@{\NAT@exlab}%
              \else
                \unskip\NAT@spacechar
                \NAT@hyper@{\NAT@date}%
              \fi
          \else
            \@citea\NAT@hyper@{%
              \NAT@nmfmt{\NAT@nm}%
              \hyper@natlinkbreak{\NAT@spacechar\NAT@@open\if*#1*\else#1\NAT@spacechar\fi}%
                {\@citeb\@extra@b@citeb}%
              \NAT@date
            }%
          \fi
          \fi
        \or\@citea\NAT@hyper@{\NAT@nmfmt{\NAT@nm}}%
        \or\@citea\NAT@hyper@{\NAT@date}%
        \or\@citea\NAT@hyper@{\NAT@alias}%
        \fi
        \if\relax\NAT@date\relax
          \NAT@def@citea
        \else
          \NAT@def@citea@close
        \fi
      \fi
      }}\ifNAT@swa\else
        % \if*#2*\else\NAT@cmt#2\fi
        \if\relax\NAT@date\relax\else\NAT@@close\fi
        \if*#2*\else\textsuperscript{#2}\fi
      \fi}{#1}{#2}}
  \renewcommand\bibsection{\nxu@chapter*{\bibname}}
  \newcommand\nxu@set@bibliography@format{%
      \renewcommand\bibfont{\fontsize{10.5bp}{16bp}\selectfont}%
      \setlength{\bibsep}{3bp \@plus 3bp \@minus 3bp}%
      \setlength{\bibhang}{21bp}%
  }
  \nxu@set@bibliography@format
  \nxu@option@hook{degree}{\nxu@set@bibliography@format}
  \nxu@option@hook{main-language}{\nxu@set@bibliography@format}
  \patchcmd\thebibliography{%
    \clubpenalty4000%
  }{%
    \interlinepenalty=5000\relax
    \clubpenalty=10000\relax
  }{}{\nxu@patch@error{\thebibliography}}
  \patchcmd\thebibliography{%
    \widowpenalty4000%
  }{%
    \widowpenalty=10000\relax
  }{}{\nxu@patch@error{\thebibliography}}
  \def\@biblabel#1{[#1]\hfill}
  \renewcommand\NAT@bibsetnum[1]{%
    % \settowidth\labelwidth{\@biblabel{#1}}%
    % \setlength{\leftmargin}{\labelwidth}%
    % \addtolength{\leftmargin}{\labelsep}%
    \setlength{\leftmargin}{1cm}%
    \setlength{\itemindent}{\z@}%
    \setlength{\labelsep}{0.1cm}%
    \setlength{\labelwidth}{0.9cm}%
    \setlength{\itemsep}{\bibsep}
    \setlength{\parsep}{\z@}%
    \ifNAT@openbib
      \addtolength{\leftmargin}{\bibindent}%
      \setlength{\itemindent}{-\bibindent}%
      \setlength{\listparindent}{\itemindent}%
      \setlength{\parsep}{0pt}%
    \fi
  }
}
\AtEndOfPackageFile*{biblatex}{
  \AtBeginDocument{
    \ifthenelse{\equal{\blx@bbxfile}{apa}}{\def\bibname{REFERENCES}}{}
    \ifthenelse{\equal{\blx@bbxfile}{apa6}}{\def\bibname{REFERENCES}}{}
    \ifthenelse{\equal{\blx@bbxfile}{mla}}{\def\bibname{WORKS CITED}}{}
    \ifthenelse{\equal{\blx@bbxfile}{mla-new}}{\def\bibname{WORKS CITED}}{}
  }
  \DeclareRobustCommand\inlinecite{\parencite}
  \defbibheading{bibliography}[\bibname]{\nxu@chapter*{\bibname}}
  \newcommand\nxu@set@bibliography@format{%
      \renewcommand\bibfont{\fontsize{10.5bp}{16bp}\selectfont}%
      \setlength{\bibitemsep}{3bp \@plus 3bp \@minus 3bp}%
      \setlength{\biblabelsep}{0.1cm}%
      \setlength{\bibhang}{21bp}%
  }
  \nxu@set@bibliography@format
  \nxu@option@hook{degree}{\nxu@set@bibliography@format}
  \nxu@option@hook{main-language}{\nxu@set@bibliography@format}
}
\AtEndOfPackageFile*{apacite}{
  \AtBeginDocument{
    \nxu@set@chapter@names
  }
  \renewcommand\bibliographytypesize{\fontsize{10.5bp}{17bp}\selectfont}
  \setlength{\bibitemsep}{6bp}
  \ifnxu@main@language@chinese
    \setlength{\bibleftmargin}{21bp}
    \setlength{\bibindent}{-\bibleftmargin}
  \else
    \setlength{\bibleftmargin}{0.5in}
    \setlength{\bibindent}{-\bibleftmargin}
  \fi
  \def\st@rtbibchapter{%
    \if@numberedbib%
      \chapter{\bibname}%   e.g.,   6. References
    \else%
      \nxu@chapter*{\bibname}%   e.g.,   References
    \fi%
  }%
}
\g@addto@macro\appendix{%
  \@mainmattertrue
}
\nxu@define@key{
  toc-depth = {
    name = toc@depth,
  },
}
\nxu@option@hook{toc-depth}{%
  \ifx\@begindocumenthook\@undefined
    \protected@write\@auxout{}{%
      \string\ttl@writefile{toc}{%
        \protect\setcounter{tocdepth}{\nxu@toc@depth}%
      }%
    }%
  \else
    \setcounter{tocdepth}{\nxu@toc@depth}%
  \fi
}
\g@addto@macro\appendix{%
  \nxusetup{
    toc-depth = 0,
  }%
}
\nxu@define@key{
  appendix-figure-in-lof = {
    name = appendix@figure@in@lof,
    choices = {
      true,
      false,
    },
    default = false,
  },
}
\nxu@option@hook{appendix-figure-in-lof}{%
  \ifnxu@appendix@figure@in@lof@true
    \addtocontents{lof}{\string\let\string\contentsline\string\ttl@contentsline}%
    \addtocontents{lot}{\string\let\string\contentsline\string\ttl@contentsline}%
    \addtocontents{loe}{\string\let\string\contentsline\string\ttl@contentsline}%
  \else
    \addtocontents{lof}{\string\let\string\contentsline\string\ttl@gobblecontents}%
    \addtocontents{lot}{\string\let\string\contentsline\string\ttl@gobblecontents}%
    \addtocontents{loe}{\string\let\string\contentsline\string\ttl@gobblecontents}%
  \fi
}
\g@addto@macro\appendix{%
  \nxusetup{
    appendix-figure-in-lof = false,
  }%
}
\newcommand\nxu@end@appendix@ref@section{}
\AtBeginOfPackageFile*{bibunits}{
  \def\bibliography#1{%
    \if@filesw
      \immediate\write\@auxout{\string\bibdata{\zap@space#1 \@empty}}%
      \immediate\write\@auxout{\string\gdef\string\bu@bibdata{#1}}%
    \fi
    \@input@{\jobname.bbl}%
    \gdef\bu@bibdata{#1}%
  }
  \def\bibliographystyle#1{%
    \ifx\@begindocumenthook\@undefined\else
      \expandafter\AtBeginDocument
    \fi
      {\if@filesw
        \immediate\write\@auxout{\string\bibstyle{#1}}%
        \immediate\write\@auxout{\string\gdef\string\bu@bibstyle{#1}}%
      \fi}%
      \gdef\bu@bibstyle{#1}%
  }
}
\AtEndOfPackageFile*{bibunits}{
  \def\@startbibunit{%
    \global\let\@startbibunitorrelax\relax
    \global\let\@finishbibunit\@finishstartedbibunit
    \global\advance\@bibunitauxcnt 1
    \if@filesw
      {\endlinechar-1
      \makeatletter
      \@input{\@bibunitname.aux}}%
      \immediate\openout\@bibunitaux\@bibunitname.aux
      \immediate\write\@bibunitaux{\string\bibstyle{\@localbibstyle}}%
    \fi
  }
  \def\bu@bibliography#1{%
    \putbib[#1]%
  }
  \def\bu@bibliographystyle#1{%
    \if@filesw
      \immediate\write\@bibunitaux{\string\gdef\string\@localbibstyle{#1}}%
    \fi
    \gdef\@localbibstyle{#1}%
  }
  \providecommand\printbibliography{\putbib\relax}%
  \g@addto@macro\appendix{%
    \renewcommand\@bibunitname{\jobname-appendix-\@alph\c@chapter}%
    \bibliographyunit[\chapter]%
    \renewcommand\bibsection{%
      \ctexset{section/numbering = false}%
      \section{\bibname}%
      \ctexset{section/numbering = true}%
    }%
    \ifnxu@degree@graduate
      \renewcommand\citenumfont{\@Alph\c@chapter.}%
      \renewcommand\@extra@binfo{@-\@alph\c@chapter}%
      \renewcommand\@extra@b@citeb{@-\@alph\c@chapter}%
      \renewcommand\bibnumfmt[1]{[\@Alph\c@chapter.#1]\hfill}%
    \fi
  }
  \renewcommand\nxu@end@appendix@ref@section{%
    \bibliographyunit\relax
  }
  \AtEndDocument{\nxu@end@appendix@ref@section}
  \renewcommand\nxu@set@survey@bibheading{%
    \renewcommand\bibsection{%
      \par
      \vskip 20bp%
      \nxu@pdfbookmark{1}{\bibname}%
      \begingroup
        \centering
        \xiaosi[1.667]\bibname\par
      \endgroup
      \vskip 6bp%
    }%
  }%
  % \let\@xtestdef\@gobbletwo  % This doesn't work
  \def\bibunits@rerun@warning{\relax}
}
\PassOptionsToPackage{defernumbers = true}{biblatex}
\AtEndOfPackageFile*{biblatex}{
  \DeclareRefcontext{appendix}{}
  \g@addto@macro\appendix{%
    \pretocmd\chapter{%
      \newrefsection
      \@tempcnta=\c@chapter
      \advance\@tempcnta\@ne
      \newrefcontext[labelprefix = {\@Alph\@tempcnta.}]{appendix}%
    }{}{\nxu@patch@error{\chapter}}%
    \defbibheading{bibliography}[\bibname]{%
      \ctexset{section/numbering = false}%
      \section{#1}%
      \ctexset{section/numbering = true}%
    }%
  }
  \renewcommand\nxu@set@survey@bibheading{%
    \defbibheading{bibliography}[\bibname]{%
      \par
      \vskip 20bp%
      \nxu@pdfbookmark{1}{\bibname}%
      \begingroup
        \centering
        \xiaosi[1.667]##1\par
      \endgroup
      \vskip 6bp%
    }%
  }%
  \def\bibliographystyle#1{%
    \nxu@warning{'bibliographystyle' invalid for 'biblatex'.}%
  }
}
\@ifpackagelater{titletoc}{2019/07/14}{
  \newcommand\nxu@print@contents[5]{%
    \printcontents[#1]{#2}{#3}[#4]{}%
  }
}{
  \newcommand\nxu@print@contents[5]{%
    \printcontents[#1]{#2}{#3}{\setcounter{tocdepth}{#4}#5}%
  }
}
\newenvironment{survey}{%
  \chapter{外文资料的调研阅读报告}%
  \nxusetup{language = english}%
  \let\title\nxu@appendix@title
  \let\maketitle\nxu@appendix@maketitle
  \nxu@set@partial@toc@format
  \renewcommand\tableofcontents{%
    \section*{Contents}%
    \nxu@pdfbookmark{1}{Contents}%
    \nxu@print@contents{survey}{l}{1}{2}{}%
    \vskip 20bp%
  }%
  \let\appendix\nxu@appendix@appendix
  \nxu@set@survey@bibheading
  \renewcommand\bibname{参考文献}%
  \startcontents[survey]%
}{%
  \stopcontents[survey]%
  \nxu@reset@main@language % restore language
}
\newcommand\nxu@set@appendix@bib@heading{}
\newenvironment{translation}{%
  \chapter{外文资料的书面翻译}%
  \nxusetup{language = chinese}%
  \let\title\nxu@appendix@title
  \let\maketitle\nxu@appendix@maketitle
  \renewenvironment{abstract}{%
    \ctexset{
      section = {
        format    += \centering,
        numbering  = false,
      },
    }%
    \section{摘要}%
  }{%
    \par
    \ifx\nxu@keywords\@empty\else
      \textbf{关键词：}\nxu@clist@use{\nxu@keywords}{；}\par
    \fi
  }%
  \nxu@set@partial@toc@format
  \renewcommand\tableofcontents{%
    \section*{目录}%
    \nxu@pdfbookmark{1}{目录}%
    \nxu@print@contents{translation}{l}{1}{2}{}%
    \vskip 20bp%
  }%
  \let\appendix\nxu@appendix@appendix
  \def\bibsection{%
    \begingroup
      \ctexset{section/numbering=false}%
      \section{\bibname}%
    \endgroup
  }%
  \startcontents[translation]%
}{%
  \stopcontents[translation]%
  \nxu@reset@main@language % restore language
}
\newenvironment{translation-index}{}{}
\AtEndOfPackageFile*{bibunits}{
  \renewenvironment{translation-index}{%
    \begin{bibunit}%
      \renewcommand\@bibunitname{\jobname-index}%
      \renewcommand\bibname{书面翻译对应的原文索引}%
      \nxu@set@survey@bibheading
  }{%
    \end{bibunit}%
  }
}
\AtEndOfPackageFile*{biblatex}{
  \renewenvironment{translation-index}{%
    \endrefsection
    \begin{refsection}%
      \renewcommand\bibname{书面翻译对应的原文索引}%
      \nxu@set@survey@bibheading
  }{%
    \end{refsection}%
  }
}
\DeclareRobustCommand\nxu@appendix@title[1]{\gdef\nxu@appendix@@title{#1}}
\newcommand\nxu@appendix@maketitle{%
  \par
  \begin{center}%
    \xiaosi[1.667]\nxu@appendix@@title
  \end{center}%
  \par
}
\newcommand\nxu@set@partial@toc@format{%
  \titlecontents{section}
    [\z@]{}
    {\contentspush{\thecontentslabel\quad}}{}
    {\nxu@leaders\thecontentspage}%
  \titlecontents{subsection}
    [1em]{}
    {\contentspush{\thecontentslabel\quad}}{}
    {\nxu@leaders\thecontentspage}%
  \titlecontents{subsubsection}
    [2em]{}
    {\contentspush{\thecontentslabel\quad}}{}
    {\nxu@leaders\thecontentspage}%
}
\newcommand\nxu@appendix@appendix{%
  \def\theHsection{\Hy@AlphNoErr{section}}%
  \setcounter{section}{0}%
  \setcounter{subsection}{0}%
  \renewcommand\thesection{\thechapter.\@Alph\c@section}%
}%
\newcommand\nxu@set@survey@bibheading{}
\newenvironment{resume}{%
  \@mainmatterfalse
  \nxu@end@appendix@ref@section
  \nxu@chapter*{\nxu@resume@name}%
  \ctexset{
    section = {
      format    += \centering,
      numbering = false,
    },
  }%
  \ifnxu@language@chinese
    \ctexset{
      subsection = {
        format     = \sffamily\fontsize{12bp}{20bp}\selectfont,
        numbering  = false,
        aftertitle = ：,
      },
    }%
    \setlist[achievements]{
      topsep     = 6bp,
      itemsep    = 6bp,
      leftmargin = 1.1cm,
      labelwidth = 1cm,
      labelsep   = 0pt,
      first      = {\fontsize{10.5bp}{14bp}\selectfont},
      align      = left,
      label      = [\arabic*],
      %resume     = achievements,  % 继续之前的列表编号
    }%
  \else
    \ctexset{
      subsection = {
        beforeskip = 0pt,
        afterskip  = 0pt,
        format     = \bfseries\normalsize,
        indent     = \parindent,
        numbering  = false,
      },
    }%
    \setlist[achievements]{
      topsep     = 0bp,
      itemsep    = 0bp,
      leftmargin = 1.75cm,
      labelsep   = 0.5cm,
      align      = right,
      label      = [\arabic*],
      %resume     = achievements,  % 继续之前的列表编号
    }%
  \fi
}{}
\newcommand\resumeitem[1]{%
  \nxu@error{The "\protect\resumeitem" is obsolete. Please update to the new format}%
}
\newcommand\researchitem[1]{%
  \nxu@error{The "\protect\researchitem" is obsolete. Please update to the new format}%
}
\newlist{achievements}{enumerate}{1}
\setlist[achievements]{
  topsep     = 6bp,
  partopsep  = 0bp,
  itemsep    = 6bp,
  parsep     = 0bp,
  leftmargin = 10mm,
  itemindent = 0pt,
  align      = left,
  label      = [\arabic*],
  resume     = achievements,
}
\newenvironment{publications}{%
  \nxu@deprecate{"publications" environment}{"achievements"}%
  \begin{achievements}%
}{%
  \end{achievements}%
}
\newcommand\publicationskip{%
  \nxu@error{The "\protect\publicationskip" is obsolete. Do not use it}%
}
\NewEnviron{comments}[1][]{%
  \nxu@end@appendix@ref@section
  \ifnxu@degree@graduate
    \@mainmatterfalse
    \kv@define@key{nxu@comments}{name}{\let\nxu@comments@name\kv@value}%
    \kv@set@family@handler{nxu@comments}{%
      \ifx\kv@value\relax
        \let\nxu@comments@name\kv@key
      \else
        \kv@handled@false
      \fi
    }%
    \kvsetkeys{nxu@comments}{#1}%
    \chapter{\nxu@comments@name}%
    \BODY\clearpage
  \fi
}
\NewEnviron{resolution}{%
  \nxu@end@appendix@ref@section
  \ifnxu@degree@graduate
    \@mainmatterfalse
    \chapter{\nxu@resolution@name}%
    \BODY\clearpage
  \fi
}
\newcommand{\record}[1]{%
  \let\nxu@record@file\@empty
  \kv@define@key{nxu@record}{file}{\let\nxu@record@file\kv@value}%
  \kv@set@family@handler{nxu@record}{%
    \ifx\kv@value\relax
      \let\nxu@record@file\kv@key
    \else
      \kv@handled@false
    \fi
  }%
  \kvsetkeys{nxu@record}{#1}%
  \ifx\nxu@record@file\@empty
    \nxu@error{File path of \protect\record\space is required}
  \fi
  \cleardoublepage
  \nxu@pdfbookmark{0}{综合论文训练记录表}%
  \includepdf[pages=-]{\nxu@record@file}%
}
\PassOptionsToPackage{
  linktoc            = all,
  bookmarksdepth     = 2,
  bookmarksnumbered  = true,
  bookmarksopen      = true,
  bookmarksopenlevel = 1,
  bookmarksdepth     = 3,
  unicode            = true,
  psdextra           = true,
  breaklinks         = true,
  plainpages         = false,
  pdfdisplaydoctitle = true,
  hidelinks,
}{hyperref}
\AtEndOfPackageFile*{hyperref}{
  \newcounter{nxu@bookmark}
  \renewcommand\nxu@pdfbookmark[2]{%
    \phantomsection
    \stepcounter{nxu@bookmark}%
    \pdfbookmark[#1]{#2}{nxuchapter.\thenxu@bookmark}%
  }
  \renewcommand\nxu@phantomsection{%
    \phantomsection
  }
  \pdfstringdefDisableCommands{%
    \let\\\relax
    \let\quad\relax
    \let\qquad\relax
    \let\hspace\@gobble
  }%
  \@ifpackagelater{hyperref}{2019/04/27}{}{%
    \g@addto@macro\psdmapshortnames{\let\mu\textmu}
  }%
  \ifnxu@main@language@chinese
    \hypersetup{
      pdflang = zh-CN,
    }%
  \else
    \hypersetup{
      pdflang = en-US,
    }%
  \fi
  \AtBeginDocument{%
    \ifnxu@main@language@chinese
      \hypersetup{
        pdftitle    = \nxu@title,
        pdfauthor   = \nxu@author,
        pdfsubject  = \nxu@degree@category,
        pdfkeywords = \nxu@keywords,
      }%
    \else
      \hypersetup{
        pdftitle    = \nxu@title@en,
        pdfauthor   = \nxu@author@en,
        pdfsubject  = \nxu@degree@category@en,
        pdfkeywords = \nxu@keywords@en,
      }%
    \fi
    \hypersetup{
      pdfcreator={\nxuthesis-v\version}}
  }%
}
\AtEndOfPackageFile*{mathtools}{
  \@ifpackageloaded{unicode-math}{
    \let\underbrace\LaTeXunderbrace
    \let\overbrace\LaTeXoverbrace
  }{}
}
\AtEndOfPackageFile*{nomencl}{
  \let\nomname\nxu@denotation@name
  \def\thenomenclature{\begin{denotation}[\nom@tempdim]}
  \def\endthenomenclature{\end{denotation}}
}
\AtEndOfPackageFile*{siunitx}{%
  \newcommand\nxu@set@siunitx@language{%
    \ifnxu@language@chinese
      \sisetup{
        list-final-separator = { 和 },
        list-pair-separator  = { 和 },
        range-phrase         = {～},
      }%
    \else
      \ifnxu@language@english
        \sisetup{
          list-final-separator = {, and },
          list-pair-separator  = { and },
          range-phrase         = { to },
        }%
      \fi
    \fi
  }
  \nxu@set@siunitx@language
  \nxu@option@hook{language}{\nxu@set@siunitx@language}
}
\AtEndOfPackageFile*{amsthm}{%
  \newtheoremstyle{nxu}
    {\z@}{\z@}
    {\normalfont}{\z@}
    {\normalfont\sffamily}{\nxu@theorem@separator}
    {0.5em}{}
  \theoremstyle{nxu}
  \newtheorem{assumption}{\nxu@assumption@name}[chapter]%
  \newtheorem{definition}{\nxu@definition@name}[chapter]%
  \newtheorem{proposition}{\nxu@proposition@name}[chapter]%
  \newtheorem{lemma}{\nxu@lemma@name}[chapter]%
  \newtheorem{theorem}{\nxu@theorem@name}[chapter]%
  \newtheorem{axiom}{\nxu@axiom@name}[chapter]%
  \newtheorem{corollary}{\nxu@corollary@name}[chapter]%
  \newtheorem{exercise}{\nxu@exercise@name}[chapter]%
  \newtheorem{example}{\nxu@example@name}[chapter]%
  \newtheorem{remark}{\nxu@remark@name}[chapter]%
  \newtheorem{problem}{\nxu@problem@name}[chapter]%
  \newtheorem{conjecture}{\nxu@conjecture@name}[chapter]%
  \renewenvironment{proof}[1][\nxu@proof@name]{\par
    \pushQED{\qed}%
    % \normalfont \topsep6\p@\@plus6\p@\relax
    \normalfont \topsep\z@\relax
    \trivlist
    \item[\hskip\labelsep
      %     \itshape
      % #1\@addpunct{.}]\ignorespaces
      \sffamily
      #1]\ignorespaces
  }{%
    \popQED\endtrivlist\@endpefalse
  }
  \renewcommand\qedsymbol{\nxu@qed}
}
\AtEndOfPackageFile*{ntheorem}{%
  \theorembodyfont{\normalfont}%
  \theoremheaderfont{\normalfont\sffamily}%
  \theoremsymbol{\nxu@qed}%
  \newtheorem*{proof}{\nxu@proof@name}%
  \theoremstyle{plain}%
  \theoremsymbol{}%
  \theoremseparator{\nxu@theorem@separator}%
  \newtheorem{assumption}{\nxu@assumption@name}[chapter]%
  \newtheorem{definition}{\nxu@definition@name}[chapter]%
  \newtheorem{proposition}{\nxu@proposition@name}[chapter]%
  \newtheorem{lemma}{\nxu@lemma@name}[chapter]%
  \newtheorem{theorem}{\nxu@theorem@name}[chapter]%
  \newtheorem{axiom}{\nxu@axiom@name}[chapter]%
  \newtheorem{corollary}{\nxu@corollary@name}[chapter]%
  \newtheorem{exercise}{\nxu@exercise@name}[chapter]%
  \newtheorem{example}{\nxu@example@name}[chapter]%
  \newtheorem{remark}{\nxu@remark@name}[chapter]%
  \newtheorem{problem}{\nxu@problem@name}[chapter]%
  \newtheorem{conjecture}{\nxu@conjecture@name}[chapter]%
}
\PassOptionsToPackage{chapter}{algorithm}
\AtEndOfPackageFile*{algorithm}{
  \floatname{algorithm}{\nxu@algorithm@name}
  \renewcommand\listofalgorithms{%
    \nxu@listof{algorithm}%
  }
  \renewcommand\listalgorithmname{\nxu@list@algorithm@name}
  \def\ext@algorithm{loa}
  \contentsuse{algorithm}{loa}
  \titlecontents{algorithm}
    [\z@]{}
    {\contentspush{\fname@algorithm~\thecontentslabel\quad}}{}
    {\nxu@leaders\thecontentspage}
}
\PassOptionsToPackage{algochapter}{algorithm2e}
\AtEndOfPackageFile*{algorithm2e}{
  \renewcommand\algorithmcfname{\nxu@algorithm@name}
  \SetAlgoCaptionLayout{nxu@caption@font}
  \SetAlCapSty{relax}
  \SetAlgoCaptionSeparator{\hspace*{1em}}
  \SetAlFnt{\fontsize{11bp}{14.3bp}\selectfont}
  \renewcommand\listofalgorithms{%
    \nxu@listof{algorithmcf}%
  }
  \renewcommand\listalgorithmcfname{\nxu@list@algorithm@name}
  \def\ext@algorithmcf{loa}
  \contentsuse{algocf}{loa}
  \titlecontents{algocf}
    [\z@]{}
    {\contentspush{\algorithmcfname~\thecontentslabel\quad}}{}
    {\nxu@leaders\thecontentspage}
}
\AtEndOfPackageFile*{minted}{
  \newcommand\nxu@set@listing@language{%
    \ifnxu@language@chinese
      \floatname{listing}{代码}%
    \else
      \floatname{listing}{Listing}%
    \fi
  }
  \nxu@set@listing@language
  \nxu@option@hook{language}{\nxu@set@listing@language}
}
\nxu@define@key{
  spine-font = {
    name = spine@font,
  },
  spine-student-id = {
    name = spine@student@id,
  },
  spine-title = {
    name = spine@title,
  },
  spine-author = {
    name = spine@author,
  },
}
\renewcommand\nxu@spine@font{%
  \ifnxu@degree@doctor
    \fontsize{16bp}{20.8bp}\selectfont
  \else
    \fontsize{15bp}{19.5bp}\selectfont
  \fi
}
\newcommand*\CJKmovesymbol[1]{\raise.3em\hbox{#1}}
\newcommand*\CJKmove{%
  \punctstyle{plain}%
  \let\CJKsymbol\CJKmovesymbol
  \let\CJKpunctsymbol\CJKsymbol
}
\NewDocumentCommand{\spine}{
	O{
	  \ifx\nxu@spine@student@id\@empty
		\nxu@student@id
	  \else
		\nxu@spine@student@id
	  \fi
	}
    O{
      \ifx\nxu@spine@title\@empty
        \nxu@title
      \else
        \nxu@spine@title
      \fi
    }
    O{
      \ifx\nxu@spine@author\@empty
        \nxu@author
      \else
        \nxu@spine@author
      \fi
    }}{%
  \clearpage
  \newgeometry{
    vmargin = 5.0cm,
    hmargin = 1cm,
  }%
  \thispagestyle{empty}%
  \ifnxu@main@language@chinese
    \nxu@pdfbookmark{0}{书脊}%
  \else
    \nxu@pdfbookmark{0}{Spine}%
  \fi
  \begingroup
    \noindent\hfill
    \rotatebox[origin=lt]{-90}{%
      \makebox[\textheight]{%
        \fangsong
        \addCJKfontfeatures*{RawFeature={vertical}}%
        \nxu@spine@font
        \CJKmove
        #1\hfill
        #2\hfill
        #3
      }%
    }%
  \endgroup
  \clearpage
  \restoregeometry
}
\DeclareRobustCommand\cs[1]{\texttt{\char`\\#1}}
\DeclareRobustCommand\file{\nolinkurl}
\DeclareRobustCommand\env{\textsf}
\DeclareRobustCommand\pkg{\textsf}
\DeclareRobustCommand\cls{\textsf}
\sloppy
\endinput
%%
%% End of file `nxuthesis.cls'.
