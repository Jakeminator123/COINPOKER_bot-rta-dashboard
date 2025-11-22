// Detection method explanations based on Prohibited_Tools_Structured_en.txt and explenation_bot_rta.md

export interface DetectionInfo {
  title: string;
  description: string;
  examples?: string[];
  prohibitedUse?: string;
}

export const detectionInfoMap: Record<string, DetectionInfo> = {
  // Screen Detection
  overlay_classes: {
    title: 'Overlay Window Classes',
    description: 'Window class names that indicate overlay windows. These are detected during screen monitoring and can be used to detect real-time assistance tools that overlay poker tables.',
    examples: ['OverlayWindow', 'DXOverlay', 'SteamOverlay', 'DiscordOverlay'],
    prohibitedUse: 'All dynamic HUDs or screen-scraping tools that read live tables are prohibited during active play.'
  },
  hud_overlay_patterns: {
    title: 'HUD Overlay Patterns',
    description: 'Patterns or keywords used to identify HUD (Heads-Up Display) tools. These detect dynamic HUDs that update during play, which are prohibited.',
    examples: ['hm3', 'pokertracker', 'drivehud', 'hand2note'],
    prohibitedUse: 'Dynamic HUDs or screen-scraping tools that read live tables are prohibited. Static HUDs showing historical stats are typically allowed.'
  },
  suspicious_keywords: {
    title: 'Suspicious Keywords',
    description: 'Keywords that trigger alerts when found in window titles or content. These indicate potentially prohibited software.',
    examples: ['overlay', 'inject', 'hook', 'dll'],
    prohibitedUse: 'Tools that inject code or overlay real-time assistance during play are prohibited.'
  },
  ignored_overlays: {
    title: 'Ignored Overlays',
    description: 'Safe system overlays to exclude from detection. These are legitimate Windows or graphics card overlays that should not trigger alerts.',
    examples: ['nvidia', 'amd', 'intel', 'windows', 'explorer'],
    prohibitedUse: 'These are safe system processes and should never trigger detection.'
  },
  safe_processes: {
    title: 'Safe Processes',
    description: 'Legitimate system processes that will never trigger alerts, even if detected. These are typically Windows core processes.',
    examples: ['explorer.exe', 'dwm.exe', 'searchhost.exe'],
    prohibitedUse: 'These are safe system processes and should never trigger detection.'
  },

  // Network Detection
  network_keywords: {
    title: 'Network Keywords',
    description: 'Keywords detected in network traffic that indicate RTA (Real-Time Assistance) sites or bot services. These are blocked during active play.',
    examples: ['gto wizard', 'gtowizard.com', 'piosolver', 'monkersolver'],
    prohibitedUse: 'All real-time assistance (RTA) and solver usage during an active hand is prohibited.'
  },
  telegram_detection: {
    title: 'Telegram Detection',
    description: 'Detects Telegram bot tokens and custom Telegram clients that could be used to relay hand information for real-time assistance during play.',
    examples: ['Custom Telegram bots', 'Telegram API tokens'],
    prohibitedUse: 'Using messaging apps to relay hand information to external assistants during play is prohibited.'
  },

  // Automation Detection
  automation_programs: {
    title: 'Automation Programs',
    description: 'Programs that can automate poker play or simulate user input. These include bots, macro tools, and automation frameworks.',
    examples: ['OpenHoldem', 'AutoHotkey', 'Python automation', 'RPA tools'],
    prohibitedUse: 'All automated play software (bots) is prohibited. This includes any program that makes decisions or takes actions automatically.'
  },

  // VM Detection
  vm_processes: {
    title: 'Virtual Machine Processes',
    description: 'Processes associated with virtual machines that could be used to hide detection or run prohibited software.',
    examples: ['VMware', 'VirtualBox', 'Hyper-V'],
    prohibitedUse: 'Using VMs to circumvent detection or run prohibited software is not allowed.'
  },

  // General
  poker_table_patterns: {
    title: 'Poker Table Patterns',
    description: 'Patterns used to identify poker table windows. Used to determine when a player is actively playing.',
    examples: ['nl ', 'plo ', 'holdem', 'omaha', 'turbo'],
    prohibitedUse: 'These are used to identify active play sessions where RTA/bot detection applies.'
  },
  title_patterns: {
    title: 'Window Title Patterns',
    description: 'Patterns to match against window titles to identify poker-related windows or prohibited tools.',
    examples: ['coinpoker', 'nl ', 'plo ', 'gto wizard'],
    prohibitedUse: 'Used to detect poker tables and prohibited RTA tools.'
  }
};

// Extended explanations based on explenation_bot_rta.md
export const programExplanations: Record<string, string> = {
  // Bots
  'warbot': 'Commercial autoplayer built on OpenHoldem concepts; runs table maps and strategy profiles to play hands automatically.',
  'holdembot': 'Commercial bot marketed for online Hold\'em that plays hands using prebuilt logic.',
  'openholdem': 'Open-source autoplayer framework with screen-scraping and a poker scripting language (OpenPPL) to make decisions.',
  'pokerbotai': 'Generic label used by modern poker bot vendors for AI-driven autoplayers.',

  // RTA Tools
  'piosolver': 'Widely used GTO solver that outputs equilibrium strategies; using it while playing constitutes RTA.',
  'monkersolver': 'High-performance solver for Hold\'em/Omaha; live use or scripted lookups create RTA risk.',
  'gto+': 'Hold\'em solver with decision-tree building; live use during a hand is RTA.',
  'simple gto': 'Trainer with instant GTO feedback; if run alongside tables it can provide real-time advice.',
  'gtowizard': 'Browser-based real-time assistant that can provide live solution advice during play.',

  // HUD Tools
  'hm3': 'HUD/database that overlays stats; if paired with external charts/scripts it can edge into RTA overlays.',
  'pokertracker': 'Database/HUD software that parses hand histories and overlays opponent statistics on tables.',
  'drivehud': 'HUD/database with GTO-style analysis modules; can be paired with solver outputs.',
  'hand2note': 'HUD with dynamic stats; can be configured to show advanced decision aids.',

  // Automation Tools
  'python': 'Via PyAutoGUI and OCR, Python can read the screen and send inputs to automate play.',
  'autohotkey': 'Windows automation scripting that can send keystrokes/clicks and read pixel colors—usable to script betting actions.',
  'autoit': 'Windows GUI automation (send keys/clicks, window/control ops); can drive a poker client via macros.',
  'powershell': 'Automation shell that can orchestrate programs and simulate inputs/scripts.',

  // Communication
  'telegram': 'Messaging app with screen-sharing and bots; could relay hands to a second device/person for advice.',
  'discord': 'Chat app with in-game overlay and streaming; can display external advice while tables are open.',

  // Android Emulators
  'ldplayer': 'Android emulator that can run mobile poker apps. Can be used to circumvent detection or run prohibited software on a separate device/emulator instance.',
  'ldplayer.exe': 'Android emulator that can run mobile poker apps. Can be used to circumvent detection or run prohibited software on a separate device/emulator instance.',
  'bluestacks': 'Android emulator commonly used to run mobile applications. Can be used to run poker apps or prohibited tools in an isolated environment.',
  'bluestacks.exe': 'Android emulator commonly used to run mobile applications. Can be used to run poker apps or prohibited tools in an isolated environment.',
  'nox': 'NoxPlayer Android emulator. Can run mobile poker apps or be used to hide prohibited software.',
  'noxvmhandle.exe': 'NoxPlayer Android emulator. Can run mobile poker apps or be used to hide prohibited software.',
  'memu': 'MEmu Android emulator. Can be used to run mobile poker applications or circumvent detection.',
  'memu.exe': 'MEmu Android emulator. Can be used to run mobile poker applications or circumvent detection.',

  // VM Processes
  'vmware': 'Virtual machine software that can be used to isolate and hide prohibited software from detection.',
  'virtualbox': 'Open-source virtualization software that can be used to run prohibited tools in an isolated environment.',
  'hyper-v': 'Microsoft virtualization platform that can be used to hide detection or run prohibited software.',

  // Additional automation tools
  'node': 'Node.js runtime that can run automation scripts via RobotJS/Puppeteer, capable of driving poker clients.',
  'node.exe': 'Node.js runtime that can run automation scripts via RobotJS/Puppeteer, capable of driving poker clients.',
  'java': 'Java runtime with AWT Robot that can generate native keyboard/mouse input for automation.',
  'java.exe': 'Java runtime with AWT Robot that can generate native keyboard/mouse input for automation.',
  'javaw.exe': 'Java runtime (headless) with AWT Robot that can generate native keyboard/mouse input for automation.',
  'sikuli': 'Image-recognition automation framework that can detect cards/buttons on screen and act accordingly.',
  'sikulix': 'Image-recognition automation that can detect cards/buttons on screen and act accordingly.',
  'selenium': 'Browser automation that can interact with web poker clients via scripted clicks/inputs.',
  'uipath': 'Enterprise RPA platform that can orchestrate desktop/web steps; could automate client interactions.',
  'blueprism': 'Enterprise RPA platform; can be scripted to drive applications and workflows.',
  'automationanywhere': 'Enterprise RPA platform; can automate UI/browser interactions.',

  // Clickers and macros
  'clickermann': 'Mouse/keyboard macro recorder or auto-clicker that can replay input sequences, enabling automation of repetitive clicks.',
  'fastclicker': 'Mouse/keyboard macro recorder or auto-clicker that can replay input sequences, enabling automation of repetitive clicks.',
  'autoclicker': 'Mouse/keyboard macro recorder or auto-clicker that can replay input sequences, enabling automation of repetitive clicks.',
  'tinytask': 'Records keyboard/mouse and replays loops; can automate repetitive table actions.',
  'macrorecorder': 'Mouse/keyboard macro recorder that can replay input sequences, enabling automation.',

  // RTA Solvers (additional)
  'icmizer': 'ICM-based push/fold and tournament calculator; using it mid-tournament provides decision assistance.',
  'pioviewer': 'Viewer for PioSolver trees; live consultation during play constitutes RTA.',
  'monkerviewer': 'Viewer for Monker ranges/trees; live reference mid-hand is RTA.',
  'simplepostflop': 'Solver that finds Nash/GTO strategies pre/postflop; becomes RTA if used during active play.',
  'deepsolver': 'Advanced solver tool that can provide real-time GTO analysis during play.',
  'plogenius': 'PLO-specific solver that provides optimal play recommendations; using during play is RTA.',
  'plomastermind': 'PLO solver with advanced analysis capabilities; live use constitutes RTA.',
  'plomatrix': 'PLO analysis tool; live consultation during play is prohibited.',
  'prometheuspoker': 'RTA tool that provides real-time poker assistance.',
  'octopipoker': 'RTA assistance tool that can provide live recommendations.',
  'rocketsolver': 'Solver tool that can provide real-time optimal play recommendations.',
  'gtobase': 'GTO database and analysis tool; live consultation during play is RTA.',

  // Additional bots
  'shankybot': 'Shanky Technologies bot family (BonusBot/PowerBot) that automated poker play via scripts and profiles.',
  'bonusbot': 'Shanky Technologies bot family that automated poker play via scripts and profiles.',
  'inhuman': 'Vendor-reported poker bot capable of reading tables and executing actions automatically.',
  'deepermind': 'Vendor-branded automated poker player claiming AI decision-making and undetectability.',
  'rtapoker': 'Real-time assistance product that screen-captures a table to produce live GTO recommendations.',
  'gtohero': 'Browser-based real-time assistant that streams your table and returns live solution advice.',

  // Data mining
  'hhdealer': 'Hand history sharing service that provides access to hands you did not play yourself. Unauthorized data collection/sharing is prohibited.',
  'drivedhud': 'HUD with cloud sharing features. Unauthorized data pools and live collection are prohibited.',

  // Table selection
  'seatmojo': 'Auto-seating tool that automatically seats you at tables based on stats/profiles. Not permitted.',
  'tablescan': 'Table scanning tool with auto-join features. Live auto-join versions are prohibited.',

  // General automation
  'cscript': 'Windows Script Host that runs VBScript/JScript to control windows and send inputs.',
  'cscript.exe': 'Windows Script Host command-line that runs VBScript/JScript to control windows and send inputs. Can be used to automate poker actions via scripts.',
  'wscript': 'Windows Script Host GUI that runs VBScript/JScript to control windows and send inputs.',
  'wscript.exe': 'Windows Script Host GUI that runs VBScript/JScript to control windows and send inputs. Can be used to automate poker actions via scripts.',
  'pwsh': 'PowerShell Core that can orchestrate programs and simulate inputs/scripts.',
  'pythonw': 'Python runtime (headless) that can read the screen and send inputs via PyAutoGUI.',
  'python3': 'Python 3 runtime that can read the screen and send inputs via PyAutoGUI.',
  'py': 'Python launcher that can run automation scripts.',

  // Additional programs from registry
  'piosolveredge': 'PioSolver Edge add-on providing extra features; same solver capability implies RTA risk if consulted mid-hand.',
  'piosolver-edge': 'PioSolver Edge add-on providing extra features; same solver capability implies RTA risk if consulted mid-hand.',
  'simplegto': 'Trainer with instant GTO feedback; if run alongside tables it can provide real-time advice.',
  'icmizer3': 'ICM-based push/fold and tournament calculator; using it mid-tournament provides decision assistance.',
  'autohotkeyu32': 'Windows automation scripting that can send keystrokes/clicks and read pixel colors—usable to script betting actions.',
  'autohotkeyu64': 'Windows automation scripting that can send keystrokes/clicks and read pixel colors—usable to script betting actions.',
  'autohotkeya32': 'Windows automation scripting that can send keystrokes/clicks and read pixel colors—usable to script betting actions.',
  'ahk': 'AutoHotkey executable; Windows automation scripting that can send keystrokes/clicks and read pixel colors.',
  'aut2exe': 'AutoIt compiler that can compile scripts to EXE files; enables distribution of automation scripts.',
  'autoit3x64': 'AutoIt 64-bit version; Windows GUI automation that can send keys/clicks and drive poker clients.',
  'gsautoclicker': 'GS Auto Clicker capable of high-frequency clicking and coordinate targeting; can spam betting buttons.',
  'opautoclicker': 'OP Auto Clicker capable of high-frequency clicking and coordinate targeting; can spam betting buttons.',
  'ghostmouse': 'Mouse/keyboard macro recorder that can replay input sequences, enabling automation of repetitive clicks.',
  'pulover': 'AHK-based recorder and script generator; enables complex input automation.',
  'macromaker': 'Legacy macro utility that records inputs and plays them back.',
  'quickmacro': 'Macro suite with triggers and UI automation features; enables scripted input loops.',
  'jitbit': 'JitBit Macro recorder that can compile to EXE and loop inputs; usable for scripted click sequences.',
  'holdemmanager': 'HUD/database that overlays stats; if paired with external charts/scripts it can edge into RTA overlays.',
  'pt4': 'PokerTracker 4 HUD/database; on-table stats can be combined with RTA content.',
  'h2n': 'Hand2Note HUD with dynamic stats and Android emulator support; can be configured to show advanced decision aids.',
  'plo4bot': 'PLO4 Bot poker bot variant; automated play software for Pot Limit Omaha 4-card games.',
  'plo5bot': 'PLO5 Bot poker bot variant; automated play software for Pot Limit Omaha 5-card games.',
  'hilobot': 'Hi-Lo Bot poker bot variant; automated play software for Hi-Lo split games.',
  'pokerbotpro': 'Commercial poker bot platform; automated play software with advanced features.',
  'grinderschool': 'GrinderSchool bot platform; automated poker play via scripts and profiles.',
  'ipokerbot': 'iPoker network-specific bot variant; automated play software for iPoker network.',
  'partybot': 'PartyPoker-specific bot variant; automated play software for PartyPoker network.',
  'pokerstarsbot': 'PokerStars-specific bot variant; automated play software for PokerStars network.',
  'odinpoker': 'Odin Poker Solver; company-acquired solver tool with web login capabilities.',
  'pokersnowie': 'PokerSnowie training software; live advice mode can provide real-time assistance during play.',
  'pokeranger': 'PokerRanger range analysis tool; using during play provides decision assistance.',
  'wpawizard': 'WPA (Win Probability Analysis) Wizard calculator; using mid-hand provides decision assistance.',
  'equilab': 'Equilab equity calculator; live data input mode can provide real-time assistance during play.',
  'simplepreflop': 'Simple Preflop Holdem RTA version; provides instant preflop recommendations during play.',
  'simpleomaha': 'Simple Omaha RTA version; provides instant Omaha recommendations during play.',
  'novasolver': 'NovaSolver GTO analysis tool; live consultation during play constitutes RTA.',
  'gto': 'Generic GTO solver label; any GTO solver used during active play constitutes RTA.',
  'bbzpoker': 'BBZPoker training platform; live consultation during play can provide real-time assistance.',
  'runitonce': 'Run It Once training platform; live consultation during play can provide real-time assistance.',
  'smartbuddy': 'SmartBuddy dynamic HUD; screen-scraping tool that reads live tables.',
  'zyngahud': 'ZyngaHUD OCR-based HUD; screen-recording/screen-capture-based tool that reads live tables.',
  'starscaption': 'StarsCaption table selection tool; seat scripting can automate table selection.',
  'partycaption': 'PartyCaption table selection tool; seat scripts can automate table selection.',
  'sharkystrator': 'SharkyStrator table selection tool; can automate table selection based on stats.',
  'tablescanturbo': 'TableScan Turbo table scanning tool; live auto-join versions can automatically seat at tables.',
  'seatscript': 'SeatScript auto-seating tool; can automatically seat you at tables based on stats/profiles.',
  'automator': 'General automation tool that can automate repetitive tasks. Can be used to automate poker actions or create bots.',
  'robot': 'Robot Framework test automation framework that can control applications and simulate user interactions. Can be used to automate poker play.',
  'robot.exe': 'Robot Framework test automation framework that can control applications and simulate user interactions. Can be used to automate poker play.',
  // Additional entries with spaces/special chars (for registry matching)
  'oh': 'OpenHoldem poker bot shorthand; open-source autoplayer framework with screen-scraping capabilities.',
  'pokerbot': 'Generic poker bot label; any automated poker player that makes decisions without human intervention is prohibited.',
  'simple postflop': 'Solver that finds Nash/GTO strategies pre/postflop; becomes RTA if used during active play.',
  'simple preflop': 'Simple Preflop Holdem RTA version; provides instant preflop recommendations during play.',
  'simple omaha': 'Simple Omaha RTA version; provides instant Omaha recommendations during play.',
  'wpa wizard': 'WPA (Win Probability Analysis) Wizard calculator; using mid-hand provides decision assistance.',
  'plo genius': 'PLO-specific solver that provides optimal play recommendations; using during play is RTA.',
  'holdem indicator': 'Holdem Indicator dynamic HUD; screen-scraping tool that reads live tables.',
  'poker crusher': 'Poker Crusher dynamic HUD; screen-scraping tool that reads live tables.',
  'poker office': 'Poker Office tracking software; dynamic HUD that can read live tables.',
  'poker edge': 'Poker Edge dynamic HUD; screen-scraping tool that reads live tables and updates mid-hand.',
  'tournament shark': 'Tournament Shark dynamic HUD; screen-scraping tool that reads live tournament tables.',
  'tablescan turbo': 'TableScan Turbo table scanning tool; live auto-join versions can automatically seat at tables.',
  'macro recorder': 'Macro recording software that can record and replay mouse/keyboard actions. Can automate poker actions.',
  'automation anywhere': 'Enterprise RPA platform that can automate UI/browser interactions.',
  'rta.poker': 'Real-time assistance product (Nefton) that screen-captures poker tables to produce live GTO recommendations during play.',
  'vision-gto-trainer': 'Vision GTO Trainer RTA tool; provides instant feedback during play.',
};

// Get detection info for a specific key
export function getDetectionInfo(key: string): DetectionInfo | undefined {
  return detectionInfoMap[key];
}

// Get program explanation
export function getProgramExplanation(programName: string): string | undefined {
  // Remove .exe and normalize - handle spaces and special characters
  const normalized = programName.toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/[^a-z0-9]/g, '');

  // Try exact match first (with .exe)
  const withExe = programName.toLowerCase();
  if (programExplanations[withExe]) {
    return programExplanations[withExe];
  }

  // Try exact match without .exe
  if (programExplanations[normalized]) {
    return programExplanations[normalized];
  }

  // Try with .exe suffix added
  if (programExplanations[normalized + '.exe']) {
    return programExplanations[normalized + '.exe'];
  }

  // Try with original name (preserving spaces/special chars)
  const originalNormalized = programName.toLowerCase().replace(/\.exe$/i, '');
  if (programExplanations[originalNormalized]) {
    return programExplanations[originalNormalized];
  }

  // Try partial matches - check if normalized contains any key or vice versa
  for (const [key, value] of Object.entries(programExplanations)) {
    const keyNormalized = key.replace(/\.exe$/i, '').replace(/[^a-z0-9]/g, '');

    // Check if normalized name contains key or key contains normalized name (with minimum length)
    if (normalized.length >= 3 && keyNormalized.length >= 3) {
      if (normalized === keyNormalized || normalized.includes(keyNormalized) || keyNormalized.includes(normalized)) {
        return value;
      }
    }

    // Also try matching with original name parts
    const nameParts = originalNormalized.split(/[\s\-_]+/);
    for (const part of nameParts) {
      if (part.length >= 3 && (part === keyNormalized || part.includes(keyNormalized) || keyNormalized.includes(part))) {
        return value;
      }
    }
  }

  return undefined;
}

// Get generic explanation based on program type and category
export function getGenericExplanation(programType: string, categories: string[]): string {
  // Check categories first
  if (categories.includes('bots')) {
    return 'Automated poker bot that can play hands without human intervention. All forms of automated play are prohibited.';
  }

  if (categories.includes('rta_tools')) {
    return 'Real-time assistance tool that can provide live advice during active hands. Using solvers or RTA tools during play is prohibited.';
  }

  if (categories.includes('macros')) {
    return 'Macro tool that can automate mouse/keyboard actions. All macro tools that automate betting or actions are prohibited.';
  }

  if (categories.includes('automation')) {
    return 'Automation tool that can script or automate user actions. Can be used to create bots or automate play, which is prohibited.';
  }

  if (categories.includes('hud_tracking')) {
    return 'HUD or tracking software that can overlay stats or read live tables. Dynamic HUDs that update during play are prohibited.';
  }

  if (categories.includes('communication')) {
    return 'Communication app that could be used to relay hand information or receive assistance during play.';
  }

  if (categories.includes('data_mining')) {
    return 'Data mining or hand history sharing service. Unauthorized access to hands you did not play is prohibited.';
  }

  // Fallback to type
  switch (programType.toLowerCase()) {
    case 'bot':
      return 'Automated poker bot that plays without human intervention. All bots are prohibited.';
    case 'rta':
      return 'Real-time assistance tool. Using RTA tools during active play is prohibited.';
    case 'solver':
      return 'GTO solver tool. Using solvers during active hands constitutes real-time assistance and is prohibited.';
    case 'macro':
      return 'Macro tool that can automate actions. Automated betting actions are prohibited.';
    case 'script':
      return 'Automation script that can control programs or simulate inputs. Can be used to automate play.';
    case 'clicker':
      return 'Auto-clicker tool that can automate mouse clicks. Automated actions during play are prohibited.';
    case 'hud':
      return 'Heads-up display that overlays stats. Dynamic HUDs that read live tables are prohibited.';
    case 'messenger':
      return 'Communication app that could be used to receive assistance during play.';
    case 'rpa':
      return 'Robotic Process Automation tool that can automate desktop/web interactions. Can be used to automate poker play.';
    case 'bot_framework':
      return 'Automation framework that can be used to create bots or automate actions.';
    default:
      return 'This software could potentially be used to gain unfair advantages or automate play, which violates poker site rules.';
  }
}

