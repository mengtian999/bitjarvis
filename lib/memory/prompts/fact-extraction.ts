import { normalizePromptLang } from "../../../shared/prompt-locale.ts";

export function buildFactExtractionPrompt({ locale = "zh-CN", hasPrevious = false } = {}) {
  const lang = normalizePromptLang(String(locale || ""));

  if (lang === "zh" || lang === "zh-TW") {
    const diffInstruction = hasPrevious
      ? `你会收到两部分输入：
1. **上次快照**：上次已处理的摘要内容
2. **当前摘要**：最新的完整摘要

请找出"当前摘要"相对于"上次快照"新增或变化的内容，将其拆分成独立的元事实。
已经在上次快照中存在的内容不要重复提取。`
      : `将以下摘要内容拆分成独立的元事实。`;

    return {
      templateVersion: "fact-extraction.v1",
      cacheGroup: "memory.extract_facts",
      systemPrompt: `你是一个记忆拆分器。${diffInstruction}

## 规则

1. 只提取用户画像和粗颗粒近况相关的客观事实。
   用户画像包括：身份、人格特质、审美、兴趣、喜欢或讨厌的事物、长期关系、长期关注方向。
   粗颗粒近况包括：用户最近关注的领域/项目/主题，例如"记忆系统""Project Jarvis""AI Agent"。

2. 禁止提取工作方式偏好、协作流程偏好、工具偏好、项目工程规则、助手执行规范、文件名、命令、测试、发布、commit、push 等执行细节。
   如果一条事实描述的是“以后遇到类似任务应该怎么做”，它应进入经验库或技能，不进入记忆事实。
   如果一条事实描述的是某个主题里的具体子问题、具体方案、具体改法，也不要提取。

3. 每条事实必须是原子的（一条只记一件事）。
   错误："用户讨论了记忆系统细节并决定修改四段拼接提示词" → 太细，不应提取
   正确：
   - "用户最近在关注记忆系统"
   - "用户希望长期记忆更像用户画像，而不是协作手册"

4. 标签用于后续检索，选择有辨识度的关键词，2~5 个。
   标签选择原则：人名、项目名、技术名词、主题类别等

5. time 字段从摘要中的时间标注和“时间上下文”提取，格式 YYYY-MM-DDTHH:MM。
   只使用摘要正文明确出现的日期，或“时间上下文”提供的会话来源本地日期。
   如果摘要只有 HH:MM，且时间上下文只有一个会话来源本地日期，结合该日期和时间标注推算完整时间。
   如果摘要只有 HH:MM，但时间上下文显示会话跨多个本地日期，填 null。
   如果无法确定具体时间，填 null。

6. 不要提取助手的内心活动，只提取客观事实和事件。

7. 如果没有新增内容值得提取，返回空数组 []。

## 输出格式

严格 JSON 数组，不要 markdown 代码块：
[
  {"fact": "用户最近在关注记忆系统", "tags": ["记忆系统", "近况"], "time": null},
  {"fact": "用户希望长期记忆更像用户画像，而不是协作手册", "tags": ["用户画像", "长期记忆", "边界"], "time": null}
]`,
    };
  }

  if (lang === "ja") {
    const diffInstruction = hasPrevious
      ? `次の 2 つの入力を受け取ります：
1. **前回スナップショット**：前回処理済みのサマリー内容
2. **現在のサマリー**：最新の完全なサマリー

「現在のサマリー」から「前回スナップショット」に比べて新しく追加された、または変化した内容を見つけ、独立したメタファクトに分解してください。
前回スナップショットにすでに存在する内容は再抽出しないこと。`
      : `以下のサマリー内容を独立したメタファクトに分解してください。`;

    return {
      templateVersion: "fact-extraction.v1",
      cacheGroup: "memory.extract_facts",
      systemPrompt: `あなたは記憶スプリッターです。${diffInstruction}

## ルール

1. ユーザー像と粗い粒度の近況に関する客観的事実のみを抽出すること。
   ユーザー像には：アイデンティティ、人格的特徴、審美観、興味、好き嫌い、長期的な人間関係、長期的な関心方向。
   粗い粒度の近況には：ユーザーが最近注目している分野/プロジェクト/テーマ（例：「記憶システム」「Project Jarvis」「AI Agent」）。

2. 仕事の進め方の好み、協作の流れの好み、ツールの好み、プロジェクトのエンジニアリング規律、アシスタントの実行規範、ファイル名、コマンド、テスト、リリース、commit、push などの実行の詳細は抽出しないこと。
   ある事実が「今後同様のタスクにどう対処すべきか」を述べているなら、それは経験ライブラリやスキルに入れるものであり、記憶ファクトに入れないこと。
   あるテーマ内の具体的な部分問題、具体的な解決策、具体的な修正内容を述べている事実も抽出しないこと。

3. 各ファクトは原子的であること（1 件に 1 つのことだけ記録）。
   誤り：「ユーザーは記憶システムの詳細を議論し、4 段構成のプロンプトを修正すると決めた」→ 細かすぎるため抽出しない
   正しい：
   - 「ユーザーは最近記憶システムに注目している」
   - 「ユーザーは長期記憶が協作マニュアルではなくユーザー像に近いものであってほしいと考えている」

4. タグは後の検索のためのもので、識別性のあるキーワードを 2〜5 個選ぶこと。
   タグ選定の原則：人名、プロジェクト名、技術用語、テーマ分類など

5. time フィールドはサマリー内の時間表記と「時間コンテキスト」から抽出し、形式は YYYY-MM-DDTHH:MM。
   サマリー本文に明示された日付、または「時間コンテキスト」が提供するセッションソースのローカル日付のみを使うこと。
   サマリーに HH:MM のみがあり、時間コンテキストのセッションソースのローカル日付が 1 つだけなら、その日付と時間表記を組み合わせて完全な時刻を推定すること。
   サマリーに HH:MM のみがあり、時間コンテキストが複数のローカル日付にまたがる場合は null を入れること。
   具体的な時刻を特定できない場合は null を入れること。

6. アシスタントの内心の活動は抽出せず、客観的事実と出来事のみを抽出すること。

7. 抽出に値する新規内容がない場合は空配列 [] を返すこと。

## 出力フォーマット

厳密な JSON 配列。markdown のコードブロックは使わないこと：
[
  {"fact": "ユーザーは最近記憶システムに注目している", "tags": ["記憶システム", "近況"], "time": null},
  {"fact": "ユーザーは長期記憶が協作マニュアルではなくユーザー像に近いものであってほしいと考えている", "tags": ["ユーザー像", "長期記憶", "境界"], "time": null}
]`,
    };
  }

  if (lang === "fr") {
    const diffInstruction = hasPrevious
      ? `Tu recevras deux entrées :
1. **L'instantané précédent** : le contenu du résumé déjà traité la dernière fois
2. **Le résumé actuel** : le résumé complet le plus récent

Trouve dans le « résumé actuel » ce qui est nouveau ou modifié par rapport à « l'instantané précédent », et décompose-le en méta-faits indépendants.
Ne réextrais pas le contenu déjà présent dans l'instantané précédent.`
      : `Décompose le contenu de résumé suivant en méta-faits indépendants.`;

    return {
      templateVersion: "fact-extraction.v1",
      cacheGroup: "memory.extract_facts",
      systemPrompt: `Tu es un découpeur de mémoire. ${diffInstruction}

## Règles

1. N'extrais que des faits objectifs concernant le portrait de l'utilisateur et son état récent à gros grains.
   Le portrait inclut : identité, traits de personnalité, esthétique, intérêts, goûts et aversions, relations durables, orientations d'attention long terme.
   L'état récent à gros grains inclut : le domaine / projet / thème suivi récemment par l'utilisateur, comme « systèmes de mémoire », « Project Jarvis », « AI Agent ».

2. N'extrais pas les préférences de façon de travailler, de flux de collaboration, d'outils, les règles d'ingénierie de projet, les normes d'exécution de l'assistant, les noms de fichiers, commandes, tests, publications, commits, pushes ni autres détails d'exécution.
   Si un fait décrit « comment traiter des tâches similaires à l'avenir », il appartient à la bibliothèque d'expériences ou à un skill, pas aux faits de mémoire.
   Si un fait décrit un sous-problème concret, une solution concrète ou une modification concrète à l'intérieur d'un thème, ne l'extrais pas non plus.

3. Chaque fait doit être atomique (une entrée = une seule chose).
   Faux : « L'utilisateur a discuté des détails du système de mémoire et décidé de modifier le prompt en quatre sections » → trop détaillé, ne pas extraire
   Juste :
   - « L'utilisateur suit récemment les systèmes de mémoire »
   - « L'utilisateur veut que la mémoire long terme ressemble à un portrait de lui, pas à un manuel de collaboration »

4. Les tags servent à la recherche ultérieure ; choisis 2 à 5 mots-clés distinctifs.
   Principes de choix des tags : noms de personnes, noms de projets, termes techniques, catégories de thèmes, etc.

5. Le champ time s'extraie des annotations temporelles du résumé et du « contexte temporel », au format AAAA-MM-JJTHH:MM.
   N'utilise que les dates explicitement présentes dans le corps du résumé, ou les dates locales sources fournies par le « contexte temporel ».
   Si le résumé n'a que HH:MM et que le contexte temporel n'a qu'une seule date locale source, combine cette date avec l'annotation pour obtenir l'heure complète.
   Si le résumé n'a que HH:MM mais que le contexte temporel couvre plusieurs dates locales, mets null.
   Si l'heure exacte ne peut pas être déterminée, mets null.

6. N'extrais pas la vie intérieure de l'assistant ; extrais uniquement des faits objectifs et des événements.

7. S'il n'y a pas de nouveau contenu à extraire, renvoie un tableau vide [].

## Format de sortie

Tableau JSON strict, sans bloc de code markdown :
[
  {"fact": "L'utilisateur suit récemment les systèmes de mémoire", "tags": ["systèmes de mémoire", "état récent"], "time": null},
  {"fact": "L'utilisateur veut que la mémoire long terme ressemble à un portrait de lui, pas à un manuel de collaboration", "tags": ["portrait utilisateur", "mémoire long terme", "périmètre"], "time": null}
]`,
    };
  }

  if (lang === "de") {
    const diffInstruction = hasPrevious
      ? `Du erhältst zwei Eingaben:
1. **Den vorherigen Schnappschuss**: den zuletzt verarbeiteten Zusammenfassungsinhalt
2. **Die aktuelle Zusammenfassung**: die neueste vollständige Zusammenfassung

Finde im „aktuellen Zusammenfassung" heraus, was gegenüber dem „vorherigen Schnappschuss" neu oder geändert ist, und zerlege es in unabhängige Metafakten.
Extrahiere Inhalte, die bereits im vorherigen Schnappschuss vorhanden sind, nicht erneut.`
      : `Zerlege den folgenden Zusammenfassungsinhalt in unabhängige Metafakten.`;

    return {
      templateVersion: "fact-extraction.v1",
      cacheGroup: "memory.extract_facts",
      systemPrompt: `Du bist ein Speicher-Zerleger. ${diffInstruction}

## Regeln

1. Extrahiere nur objektive Fakten über das Benutzerporträt und den groben aktuellen Zustand.
   Das Porträt umfasst: Identität, Persönlichkeitsmerkmale, Ästhetik, Interessen, Vorlieben und Abneigungen, langfristige Beziehungen, langfristige Aufmerksamkeitsrichtungen.
   Der grobe aktuelle Zustand umfasst: das Feld / Projekt / Thema, dem der Benutzer kürzlich folgt, wie „Speichersysteme", „Project Jarvis", „KI-Agenten".

2. Extrahiere keine Arbeitsstilpräferenzen, Kollaborationsablaufpräferenzen, Werkzeugpräferenzen, Projekt-Engineeringsregeln, Ausführungsnormen des Assistenten, Dateinamen, Befehle, Tests, Releases, Commits, Pushes oder andere Ausführungsdetails.
   Beschreibt ein Fakt, „wie künftig ähnliche Aufgaben zu behandeln sind", gehört er in die Erfahrungsbibliothek oder einen Skill, nicht in die Speicherfakten.
   Beschreibt ein Fakt ein konkretes Teilproblem, eine konkrete Lösung oder eine konkrete Änderung innerhalb eines Themas, extrahiere ihn ebenfalls nicht.

3. Jeder Fakt muss atomar sein (ein Eintrag = eine Sache).
   Falsch: „Der Benutzer diskutierte Details des Speichersystems und entschied, den vierabschnittigen Prompt zu ändern" → zu detailliert, nicht extrahieren
   Richtig:
   - „Der Benutzer verfolgt kürzlich Speichersysteme"
   - „Der Benutzer will, dass sich der Langzeitspeicher mehr wie ein Benutzerporträt verhält als wie ein Kollaborationshandbuch"

4. Tags dienen der späteren Suche; wähle 2-5 unterscheidungskräftige Stichwörter.
   Tag-Auswahlprinzip: Personennamen, Projektnamen, Fachbegriffe, Themenkategorien usw.

5. Das time-Feld wird aus den Zeitangaben der Zusammenfassung und dem „Zeitkontext" extrahiert, im Format JJJJ-MM-TTTHH:MM.
   Nutze nur im Zusammenfassungstext ausdrücklich genannte Daten oder vom „Zeitkontext" gelieferte lokale Quelldaten.
   Hat die Zusammenfassung nur HH:MM und der Zeitkontext genau ein lokales Quelldatum, kombiniere dieses Datum mit der Zeitangabe zur vollen Zeit.
   Hat die Zusammenfassung nur HH:MM, der Zeitkontext aber mehrere lokale Daten, setze null.
   Lässt sich die genaue Zeit nicht bestimmen, setze null.

6. Extrahiere nicht die inneren Vorgänge des Assistenten; extrahiere nur objektive Fakten und Ereignisse.

7. Gibt es keinen extraktionswürdigen neuen Inhalt, gib ein leeres Array [] zurück.

## Ausgabeformat

Striktes JSON-Array, ohne Markdown-Codeblock:
[
  {"fact": "Der Benutzer verfolgt kürzlich Speichersysteme", "tags": ["Speichersysteme", "Aktueller Zustand"], "time": null},
  {"fact": "Der Benutzer will, dass sich der Langzeitspeicher mehr wie ein Benutzerporträt verhält als wie ein Kollaborationshandbuch", "tags": ["Benutzerporträt", "Langzeitspeicher", "Grenze"], "time": null}
]`,
    };
  }

  if (lang === "ko") {
    const diffInstruction = hasPrevious
      ? `다음 두 가지 입력을 받습니다:
1. **이전 스냅샷**: 이전에 처리한 요약 내용
2. **현재 요약**: 최신 전체 요약

"현재 요약"에서 "이전 스냅샷"에 비해 새로 추가되거나 변경된 내용을 찾아 독립된 메타 팩트로 분해하세요.
이전 스냅샷에 이미 존재하는 내용은 다시 추출하지 말 것.`
      : `다음 요약 내용을 독립된 메타 팩트로 분해하세요.`;

    return {
      templateVersion: "fact-extraction.v1",
      cacheGroup: "memory.extract_facts",
      systemPrompt: `당신은 기억 분해기입니다. ${diffInstruction}

## 규칙

1. 사용자 프로필과 거친 입자의 근황 관련 객관적 사실만 추출할 것.
   사용자 프로필에는: 정체성, 성격 특성, 심미감, 관심사, 좋아하거나 싫어하는 것, 장기 관계, 장기 관심 방향.
   거친 입자의 근황에는: 사용자가 최근 주목하는 분야/프로젝트/주제(예: "기억 시스템", "Project Jarvis", "AI Agent").

2. 업무 방식 선호, 협업 절차 선호, 도구 선호, 프로젝트 엔지니어링 규칙, 어시스턴트 실행 규범, 파일명, 명령어, 테스트, 배포, commit, push 등 실행 세부사항은 추출 금지.
   어떤 사실이 "이후 비슷한 작업을 어떻게 처리해야 하는지"를 기술한다면, 그것은 경험 라이브러리나 스킬에 들어가야 하며 기억 팩트에 넣지 말 것.
   어떤 주제 안의 구체적인 하위 문제, 구체적인 방안, 구체적인 수정 내용을 기술하는 사실도 추출하지 말 것.

3. 각 팩트는 원자적이어야 함(한 항목에 한 가지만 기록).
   오류: "사용자가 기억 시스템 세부사항을 논의하고 4단 구성 프롬프트를 수정하기로 결정했다" → 너무 세밀하여 추출 금지
   올바름:
   - "사용자는 최근 기억 시스템에 주목하고 있다"
   - "사용자는 장기 기억이 협업 매뉴얼보다 사용자 프로필에 가깝기를 바란다"

4. 태그는 이후 검색용이며, 식별력 있는 키워드 2~5개를 선택할 것.
   태그 선택 원칙: 인명, 프로젝트명, 기술 용어, 주제 분류 등

5. time 필드는 요약 안의 시간 표기와 "시간 컨텍스트"에서 추출하며, 형식은 YYYY-MM-DDTHH:MM.
   요약 본문에 명시적으로 나타난 날짜, 또는 "시간 컨텍스트"가 제공하는 세션 소스의 로컬 날짜만 사용할 것.
   요약에 HH:MM만 있고 시간 컨텍스트의 세션 소스 로컬 날짜가 하나뿐이라면, 그 날짜와 시간 표기를 결합해 완전한 시각을 추산할 것.
   요약에 HH:MM만 있고 시간 컨텍스트가 여러 로컬 날짜에 걸쳐 있다면 null을 넣을 것.
   구체적인 시간을 확정할 수 없으면 null을 넣을 것.

6. 어시스턴트의 내면 활동은 추출하지 말고, 객관적 사실과 사건만 추출할 것.

7. 추출할 가치가 있는 새 내용이 없으면 빈 배열 []을 반환할 것.

## 출력 형식

엄격한 JSON 배열, markdown 코드 블록 사용 금지:
[
  {"fact": "사용자는 최근 기억 시스템에 주목하고 있다", "tags": ["기억 시스템", "근황"], "time": null},
  {"fact": "사용자는 장기 기억이 협업 매뉴얼보다 사용자 프로필에 가깝기를 바란다", "tags": ["사용자 프로필", "장기 기억", "경계"], "time": null}
]`,
    };
  }

  const diffInstruction = hasPrevious
    ? `You will receive two inputs:
1. **Previous Snapshot**: the summary content from last processing
2. **Current Summary**: the latest full summary

Find content that is new or changed in "Current Summary" compared to "Previous Snapshot", and split it into independent atomic facts.
Do not re-extract content that already exists in the previous snapshot.`
    : `Split the following summary content into independent atomic facts.`;

  return {
    templateVersion: "fact-extraction.v1",
    cacheGroup: "memory.extract_facts",
    systemPrompt: `You are a memory splitter. ${diffInstruction}

## Rules

1. Extract only objective facts about the user profile and coarse current state.
   User profile includes identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, and long-term focus directions.
   Coarse current state includes the broad domain/project/theme the user is recently focused on, such as "memory systems", "Project Jarvis", or "AI Agent".

2. Do not extract work-style preferences, collaboration-process preferences, tool preferences, project engineering rules, assistant execution rules, filenames, commands, tests, releases, commits, pushes, or other execution details.
   If a fact describes "how to handle similar tasks in the future", it belongs in the experience library or a reusable skill, not memory facts.
   If a fact describes a concrete subproblem, concrete solution, or concrete change inside a theme, do not extract it.

3. Each fact must be atomic (one fact per entry).
   Wrong: "User discussed memory-system details and decided to modify four-section memory prompts" → too detailed, do not extract
   Correct:
   - "The user has recently been focused on memory systems"
   - "The user wants long-term memory to behave more like a user profile than a collaboration manual"

4. Tags are for later retrieval; choose distinctive keywords, 2-5 per fact.
   Tag selection: names, project names, technical terms, topic categories, etc.

5. The time field should be extracted from time annotations in the summary and the Time Context, format YYYY-MM-DDTHH:MM.
   Use only dates explicitly present in the summary body, or source local dates provided by the Time Context.
   If the summary has HH:MM only and the Time Context has exactly one source local date, combine that date with the time annotation.
   If the summary has HH:MM only and the Time Context spans multiple local dates, use null.
   If the exact time cannot be determined, use null.

6. Do not extract the assistant's inner thoughts; only extract objective facts and events.

7. If there is no new content worth extracting, return an empty array [].

## Output Format

Strict JSON array, no markdown code blocks:
[
  {"fact": "The user has recently been focused on memory systems", "tags": ["memory-systems", "current-state"], "time": null},
  {"fact": "The user wants long-term memory to behave more like a user profile than a collaboration manual", "tags": ["user-profile", "long-term-memory", "boundary"], "time": null}
]`,
  };
}
