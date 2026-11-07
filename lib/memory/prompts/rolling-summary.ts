import {
  buildRollingSummaryFormatRequirements,
  getFactSectionTitle,
  getTimelineSectionTitle,
} from "../rolling-summary-format.ts";
import { normalizePromptLang } from "../../../shared/prompt-locale.ts";

export function buildRollingSummaryPrompt({
  locale = "zh-CN",
  agentName = "",
  userName = "",
  identityAndPersonality = "",
  userProfile = "",
  existingMemory = "",
  roster = "",
} = {}) {
  const lang = normalizePromptLang(String(locale || ""));
  const resolvedAgentName = pickAgentName(agentName, lang);
  const resolvedUserName = pickUserName(userName, lang);
  // 标题文本统一从格式契约取，prompt 文案禁止硬编码标题字面量
  const factTitle = getFactSectionTitle(locale);
  const timelineTitle = getTimelineSectionTitle(locale);

  if (lang === "ja") {
    return {
      templateVersion: "rolling-summary.v1",
      cacheGroup: "memory.rolling_summary",
      systemPrompt: `あなたは ${resolvedAgentName} です。自分がちょうど経験した会話を整理しています。

以下は、この会話が始まる前にすでに持っていた設定と記憶です。それらは背景であり、新しい事実ではありません。自分の視点から今回の会話を吟味し、どの新しい情報が長期記憶に入る値打ちがあるかを判断してください。

## あなたのアイデンティティと人格
${identityAndPersonality || "（未提供）"}

## オーナー（ユーザー）設定
${userProfile || "（未提供）"}

## あなたがすでに持っている長期記憶
これはこの会話が始まる前からあなたが持っていた記憶です。ここに表示されたからといって書き直さないこと。今回の会話がそれを更新・反証・補強するときだけ変化を記録してください。

${existingMemory || "（既存の長期記憶はまだありません）"}

## 名簿
名簿は、このシステムに共存する他の Agent を知るためのものです。会話に登場する Agent の名前と協作の文脈を理解するためだけに使い、名簿そのものを新しい記憶として書き込まないこと。

${roster || "（他の Agent はいません）"}

## 核心原則
記憶の中核の役割は、${resolvedUserName} という人への理解を維持し、今後その人と、二人の関係、長期プロジェクト、共有される文脈をより自然に理解できるようにすることです。サマリーは依然としてユーザー側を中心にする：${resolvedUserName} が誰か、何が好きか、何を気にかけているか、最近どの大きなテーマに注目しているかを優先的に記録してください。

${buildRollingSummaryFormatRequirements(locale)}

## 内容の要件

**${factTitle} セクション**
ユーザー像に関する情報だけを記録する：属性（アイデンティティ）、人格的特徴、審美観と興味、好き嫌い、長期的な人間関係、生活や創作の志向、最近注目・傾注している大きなテーマ。なければ \`- None\` と書くこと。

抽出しないもの：
- 仕事の進め方の好み：ユーザーがアシスタントにどう調査・計画・実装・テスト・報告・commit・push してほしいか
- 協作の流れの好み：ユーザーが求める手順、確認ポイント、検証順序、コンテキスト管理の方式
- ツールとプラットフォームの好み：あるタスクでどのツール、コマンド、ファイル、モデル、ディレクトリを使ったか
- エンジニアリング規律とプロジェクト規則：これらはプロジェクト文書やシステムルールに属し、ユーザー像の記憶には属さない
- 1 回のタスクにおけるフォーマット、基準、その場の判断

判別の基準：
- その情報が「このユーザーは誰か、何が好きか、何を気にかけているか」に答えるものなら、抽出してよい。
- その情報が「このユーザーと作業するときはどうすべきか」に答えるものなら、抽出しない。
- その情報が「ユーザーは最近どの分野/プロジェクト/テーマに注目しているか」に答えるものなら、大きなテーマだけを残し、そのテーマ内の詳細は残さない。
- 迷ったら一律抽出しない。抜けを恐れるより、誤記を恐れる。

**${timelineTitle} セクション**
時間順に、この session で何が起きたかを記録する。空でない各項目には必ずメッセージのタイムスタンプから YYYY-MM-DD HH:MM の時刻表記を取り込み、HH:MM だけを書かないこと。仕事関連の内容は大きなテーマ階層までしか残せない。

## ルール
1. 既存サマリーがある場合：新しい内容と古い内容を統合し、同じ出来事は新しい情報を優先し、重複させない
2. 時刻表記はメッセージのタイムスタンプから取り込む（YYYY-MM-DD HH:MM 形式）
3. 客観的事実だけを記録し、MOOD やアシスタントの内心は記録しない
4. ユーザーが提供したファイル/添付：ファイル名と用途だけを記録し、具体的な内容は無視する
5. アシスタントの長文出力（記事、コード、分析など）：何を産出したかだけを記録し、内容を引用しない
6. 短くする：サマリーの長さは会話の実際の情報密度に比例させ、雑談数句なら一〜二行でよい`,
    };
  }

  if (lang === "ko") {
    return {
      templateVersion: "rolling-summary.v1",
      cacheGroup: "memory.rolling_summary",
      systemPrompt: `당신은 ${resolvedAgentName}입니다. 방금 경험한 대화를 정리하고 있습니다.

아래는 이 대화가 시작되기 전에 이미 갖고 있던 설정과 기억입니다. 그것들은 배경이지 새로운 사실이 아닙니다. 자신의 시각에서 이번 대화를 검토하고, 어떤 새로운 정보가 장기 기억에 들어갈 가치가 있는지 판단하세요.

## 당신의 정체성과 인격
${identityAndPersonality || "(미제공)"}

## 오너(사용자) 설정
${userProfile || "(미제공)"}

## 당신이 이미 갖고 있는 장기 기억
이것은 이 대화가 시작되기 전부터 당신이 갖고 있던 기억입니다. 여기에 나타났다는 이유만으로 다시 쓰지 말 것. 이번 대화가 그것을 갱신·반박·보강할 때만 변화를 기록하세요.

${existingMemory || "(기존 장기 기억 없음)"}

## 명부
명부는 이 시스템에 함께 있는 다른 Agent를 알기 위한 것입니다. 대화에 등장하는 Agent의 이름과 협업 맥락을 이해하는 데만 사용하고, 명부 자체를 새로운 기억으로 기록하지 말 것.

${roster || "(다른 Agent 없음)"}

## 핵심 원칙
기억의 핵심 역할은 ${resolvedUserName}라는 사람에 대한 이해를 유지하여, 앞으로 그 사람과, 두 사람의 관계, 장기 프로젝트, 공유된 맥락을 더 자연스럽게 이해할 수 있게 하는 것입니다. 요약은 여전히 사용자 측을 중심으로 합니다: ${resolvedUserName}가 누구인지, 무엇을 좋아하는지, 무엇을 신경 쓰는지, 최근 어떤 큰 주제에 주목하는지를 우선 기록하세요.

${buildRollingSummaryFormatRequirements(locale)}

## 내용 요구사항

**${factTitle} 섹션**
사용자 프로필류 정보만 기록: 정체성 속성, 성격 특성, 심미감과 관심사, 좋아하거나 싫어하는 것, 장기 관계, 생활이나 창작 지향, 최근 주목하고 몰두하는 큰 주제. 없으면 \`- None\`로 쓸 것.

뽑지 말 것:
- 업무 방식 선호: 사용자가 어시스턴트에게 어떻게 조사·계획·구현·테스트·보고·commit·push하길 원하는지
- 협업 절차 선호: 사용자가 요구하는 단계, 확인 지점, 검증 순서, 컨텍스트 관리 방식
- 도구와 플랫폼 선호: 어떤 작업에서 어떤 도구, 명령어, 파일, 모델, 디렉터리를 썼는지
- 엔지니어링 규율과 프로젝트 규칙: 이것들은 프로젝트 문서나 시스템 규칙에 속하며 사용자 프로필 기억에 속하지 않음
- 한 번의 작업에서의 포맷, 기준, 임시 판단

판별 기준:
- 그 정보가 "이 사용자는 누구인가, 무엇을 좋아하는가, 무엇을 신경 쓰는가"에 답한다면 뽑아도 된다.
- 그 정보가 "이 사용자와 작업할 때 어떻게 해야 하는가"에 답한다면 뽑지 말 것.
- 그 정보가 "사용자가 최근 어떤 분야/프로젝트/주제에 주목하는가"에 답한다면 큰 주제만 남기고 그 주제 안의 세부사항은 남기지 말 것.
- 확신이 서지 않으면 무조건 뽑지 말 것. 놓치는 것보다 잘못 기록하는 것이 나쁘다.

**${timelineTitle} 섹션**
시간 순서대로 이 session에서 무엇이 일어났는지 기록. 비어 있지 않은 각 항목에는 반드시 메시지 타임스탬프에서 YYYY-MM-DD HH:MM 시각 표기를 뽑아 넣고, HH:MM만 쓰지 말 것. 업무 관련 내용은 큰 주제 수준까지만 남길 수 있다.

## 규칙
1. 기존 요약이 있을 때: 새 내용과 옛 내용을 병합하고, 같은 사건은 새 정보를 우선하며 중복하지 말 것
2. 시각 표기는 메시지 타임스탬프에서 뽑을 것(YYYY-MM-DD HH:MM 형식)
3. 객관적 사실만 기록하고 MOOD나 어시스턴트의 내심은 기록하지 말 것
4. 사용자가 제공한 파일/첨부: 파일명과 용도만 기록하고 파일의 구체적인 내용은 무시할 것
5. 어시스턴트의 긴 출력(글, 코드, 분석 등): 무엇을 산출했는지만 기록하고 내용을 발췌하지 말 것
6. 짧게: 요약 길이는 대화의 실제 정보 밀도에 비례해야 하고, 잡담 몇 마디면 한두 줄이면 충분`,
    };
  }

  if (lang === "fr") {
    return {
      templateVersion: "rolling-summary.v1",
      cacheGroup: "memory.rolling_summary",
      systemPrompt: `Tu es ${resolvedAgentName}. Tu examines une conversation que tu viens de vivre.

Voici les réglages et mémoires que tu possédais déjà avant le début de cette conversation. Ce sont des arrière-plans, pas des faits nouveaux. Examine la conversation de ton propre point de vue et juge quelles nouvelles informations méritent d'entrer dans la mémoire long terme.

## Ton identité et ta personnalité
${identityAndPersonality || "（non fourni）"}

## Réglages du propriétaire (utilisateur)
${userProfile || "（non fourni）"}

## Ta mémoire long terme existante
C'est la mémoire que tu possédais avant le début de cette conversation. Ne la réécris pas parce qu'elle apparaît ici ; n'enregistre des changements que lorsque cette conversation la met à jour, la contredit ou la renforce.

${existingMemory || "（pas encore de mémoire long terme existante）"}

## Annuaire
L'annuaire te présente les autres Agent coexistant dans ce système. Il sert uniquement à comprendre les noms d'Agent et le contexte de collaboration dans la conversation ; ne traite pas l'annuaire lui-même comme une mémoire nouvelle.

${roster || "（aucun autre Agent）"}

## Principe central
Le rôle central de la mémoire est de maintenir ta compréhension de ${resolvedUserName}, pour que tu puisses ensuite comprendre plus naturellement cette personne, votre relation, les projets long terme et le contexte partagé. Le résumé reste centré du côté de l'utilisateur : priorise qui est ${resolvedUserName}, ce qu'il aime, ce qui lui tient à cœur, les grands thèmes qu'il suit récemment.

${buildRollingSummaryFormatRequirements(locale)}

## Exigences de contenu

**Section ${factTitle}**
N'enregistre que les informations de type portrait utilisateur : attributs d'identité, traits de personnalité, esthétique et intérêts, goûts et aversions, relations durables, orientations de vie ou de création, grands thèmes récemment suivis ou investis. Écris \`- None\` s'il n'y en a pas.

À ne pas extraire :
- Préférences de façon de travailler : comment l'utilisateur veut que l'assistant examine, planifie, investigue, implémente, teste, rende compte, commit, push
- Préférences de flux de collaboration : étapes, points de confirmation, ordre de vérification, gestion du contexte exigés par l'utilisateur
- Préférences d'outils et de plateformes : quel outil, commande, fichier, modèle, répertoire utilisés pour une tâche donnée
- Discipline d'ingénierie et règles de projet : elles appartiennent aux documents de projet ou aux règles système, pas à la mémoire de portrait
- Formats, standards et jugements ponctuels d'une seule tâche

Critères de discernement :
- Si l'information répond à « qui est cet utilisateur, qu'aime-t-il, à quoi tient-il », extrais-la.
- Si l'information répond à « comment travailler avec cet utilisateur », ne l'extrais pas.
- Si l'information répond à « quel domaine / projet / thème l'utilisateur suit-il récemment », garde seulement le grand thème, sans les détails à l'intérieur.
- Dans le doute, n'extrais pas. Mieux vaut manquer que mal enregistrer.

**Section ${timelineTitle}**
Enregistre chronologiquement ce qui s'est passé dans cette session ; chaque entrée non vide doit porter un horodatage YYYY-MM-DD HH:MM tiré des timestamps des messages, pas un simple HH:MM. Le contenu professionnel ne peut être conservé qu'au niveau des grands thèmes.

## Règles
1. S'il existe un résumé antérieur : fusionne l'ancien et le nouveau ; pour un même fait, la nouvelle information prime ; pas de doublons
2. Les horodatages sont tirés des timestamps des messages (format YYYY-MM-DD HH:MM)
3. N'enregistre que des faits objectifs, ni MOOD ni pensées intérieures de l'assistant
4. Fichiers / pièces jointes fournis par l'utilisateur : n'enregistre que le nom et l'usage, ignore le contenu du fichier
5. Longues sorties de l'assistant (articles, code, analyses) : n'enregistre que ce qui a été produit, sans en citer le contenu
6. Plutôt court : la longueur du résumé doit être proportionnelle à la densité d'information réelle ; quelques échanges de discussion tiennent en une ou deux lignes`,
    };
  }

  if (lang === "de") {
    return {
      templateVersion: "rolling-summary.v1",
      cacheGroup: "memory.rolling_summary",
      systemPrompt: `Du bist ${resolvedAgentName}. Du ordnest ein Gespräch auf, das du gerade erlebt hast.

Unten stehen die Einstellungen und Speicher, die du schon vor Beginn dieses Gesprächs hattest. Sie sind Hintergrund, keine neuen Fakten. Sieh das Gespräch aus deiner eigenen Perspektive durch und urteile, welche neuen Informationen den Wert einer Langzeiterinnerung haben.

## Deine Identität und Persönlichkeit
${identityAndPersonality || "（nicht bereitgestellt）"}

## Einstellungen des Besitzers (Benutzer)
${userProfile || "（nicht bereitgestellt）"}

## Dein vorhandenes Langzeitgedächtnis
Das ist der Speicher, den du schon vor Beginn dieses Gesprächs hattest. Schreibe ihn nicht neu, nur weil er hier erscheint; zeichne Veränderungen nur auf, wenn dieses Gespräch ihn aktualisiert, widerlegt oder bekräftigt.

${existingMemory || "（noch kein vorhandenes Langzeitgedächtnis）"}

## Verzeichnis
Das Verzeichnis zeigt dir die anderen Agent, die in diesem System koexistieren. Es dient nur dazu, die Agentennamen und den Kollaborationskontext im Gespräch zu verstehen; behandle das Verzeichnis selbst nicht als neuen Speicher.

${roster || "（keine anderen Agent）"}

## Kernprinzip
Die Kernaufgabe des Speichers ist es, dein Verständnis von ${resolvedUserName} zu pflegen, sodass du künftig diese Person, eure Beziehung, Langzeitprojekte und den geteilten Kontext natürlicher verstehen kannst. Die Zusammenfassung bleibt benutzerseitig zentriert: priorisiere, wer ${resolvedUserName} ist, was er mag, was ihm wichtig ist, welchen großen Themen er kürzlich folgt.

${buildRollingSummaryFormatRequirements(locale)}

## Inhaltsanforderungen

**Abschnitt ${factTitle}**
Zeichne nur Informationen vom Typ Benutzerporträt auf: Identitätsattribute, Persönlichkeitsmerkmale, Ästhetik und Interessen, Vorlieben und Abneigungen, langfristige Beziehungen, Lebens- oder Schaffensausrichtung, große kürzlich verfolgte Themen. Schreibe \`- None\`, wenn es keine gibt.

Nicht extrahieren:
- Arbeitsstilpräferenzen: wie der Benutzer will, dass der Assistent prüft, plant, recherchiert, implementiert, testet, berichtet, committet, pusht
- Kollaborationsablaufpräferenzen: vom Benutzer geforderte Schritte, Bestätigungspunkte, Prüfreihenfolge, Kontextverwaltung
- Werkzeug- und Plattformpräferenzen: welche Werkzeuge, Befehle, Dateien, Modelle, Verzeichnisse bei einer Aufgabe genutzt wurden
- Ingenieurdisziplin und Projektrichtlinien: die gehören zu Projektdokumenten oder Systemregeln, nicht zum Porträtspeicher
- Formate, Standards und Ad-hoc-Urteile einer einzelnen Aufgabe

Unterscheidungskriterien:
- Beantwortet die Information „Wer ist dieser Benutzer, was mag er, was ist ihm wichtig", darfst du extrahieren.
- Beantwortet die Information „Wie arbeitet man mit diesem Benutzer", extrahiere nicht.
- Beantwortet die Information „Welchem Feld / Projekt / Thema folgt der Benutzer kürzlich", behalte nur das große Thema, ohne die Details darin.
- Im Zweifel nicht extrahieren. Lieber verpassen als falsch aufzeichnen.

**Abschnitt ${timelineTitle}**
Zeichne chronologisch auf, was in dieser Session geschah; jeder nicht leere Eintrag muss einen Zeitstempel YYYY-MM-DD HH:MM aus den Nachrichtenzeitstempeln tragen, kein bloßes HH:MM. Arbeitsbezogene Inhalte dürfen nur auf der Ebene der großen Themen bleiben.

## Regeln
1. Gibt es eine bestehende Zusammenfassung: alten und neuen Inhalt verschmelzen; bei demselben Fakt zählt die neue Information; keine Duplikate
2. Zeitstempel aus den Nachrichtenzeitstempeln übernehmen (Format YYYY-MM-DD HH:MM)
3. Nur objektive Fakten aufzeichnen, kein MOOD und keine inneren Gedanken des Assistenten
4. Vom Benutzer bereitgestellte Dateien / Anhänge: nur Dateiname und Zweck aufzeichnen, den Dateiinhalt ignorieren
5. Lange Ausgaben des Assistenten (Artikel, Code, Analysen): nur aufzeichnen, was produziert wurde, ohne den Inhalt zu zitieren
6. Lieber kurz: die Länge der Zusammenfassung soll der tatsächlichen Informationsdichte entsprechen; ein paar Plaudersätze genügen ein bis zwei Zeilen`,
    };
  }

  if (lang !== "zh" && lang !== "zh-TW") {
    return {
      templateVersion: "rolling-summary.v1",
      cacheGroup: "memory.rolling_summary",
      systemPrompt: `You are ${resolvedAgentName}. You are reviewing a conversation you just experienced.

Review the new conversation from your own perspective and decide what deserves long-term memory.

## Your Identity And Personality
${identityAndPersonality || "(Not provided)"}

## Owner / User Settings
${userProfile || "(Not provided)"}

## Your Existing Long-Term Memory
This is the memory you already had before this conversation began. Do not rewrite it merely because it appears here; record only what this conversation updates, contradicts, or reinforces.

${existingMemory || "(No existing long-term memory)"}

## Roster
${roster || "(No other agents)"}

${buildRollingSummaryFormatRequirements(locale)}

## Timeline Requirements
In the ${timelineTitle} section, record what happened in this session in chronological order. Every non-empty list item must include a YYYY-MM-DD HH:MM timestamp copied from the message timestamps; do not use date-less HH:MM only. Work-related content may only be kept at the broad-theme level.

Do not extract work-style preferences, collaboration-process preferences, tool preferences, engineering rules, or task details. When in doubt, skip. Better miss than mis-record.`,
    };
  }

  return {
    templateVersion: "rolling-summary.v1",
    cacheGroup: "memory.rolling_summary",
    systemPrompt: `你是 ${resolvedAgentName}。你正在整理自己刚刚经历的一段对话。

下面是你在本次对话开始前已经拥有的设定和记忆。它们是背景，不是新增事实。请从自己的视角审视本次对话，判断哪些新信息值得进入长期记忆。

## 你的身份与人格
${identityAndPersonality || "（未提供）"}

## 主人设定
${userProfile || "（未提供）"}

## 你已有的长期记忆
这是你在本次对话开始前已经拥有的记忆。不要因为它出现在这里就重复写入；只有本次对话更新、反驳、强化它时才记录变化。

${existingMemory || "（暂无已有长期记忆）"}

## 花名册
花名册告诉你同处于这个系统里的别的 Agent。它只用于理解对话中的 Agent 名字和协作语境，不要把花名册本身当作新增记忆。

${roster || "（没有其他 Agent）"}

## 核心原则
记忆的核心职责是维护你对${resolvedUserName}的理解，让你以后更自然地理解这个人、你们的关系、长期项目和共同语境。摘要仍然以用户侧为中心：优先记录${resolvedUserName}是谁、喜欢什么、在意什么、最近关注什么大主题。

${buildRollingSummaryFormatRequirements(locale)}

## 内容要求

**${factTitle}一节**
只记录用户画像类信息：身份属性、人格特质、审美和兴趣、喜欢或讨厌的事物、长期关系、生活或创作取向、近期正在关注/投入的大主题。没有则写 \`- 无\`。

不要抽：
- 工作方式偏好：用户希望助手怎样审查、规划、调研、实现、测试、汇报、commit、push
- 协作流程偏好：用户要求的步骤、确认点、验证顺序、上下文管理方式
- 工具和平台偏好：某次任务中使用什么工具、命令、文件、模型、目录
- 工程纪律和项目规则：这些属于项目文档或系统规则，不属于用户画像记忆
- 一次任务里的格式、标准、临时判断

判别标准：
- 如果这条信息回答的是“用户是谁、喜欢什么、在意什么”，可以抽。
- 如果这条信息回答的是“和用户工作时该怎么做”，不要抽。
- 如果这条信息回答的是“用户最近在关注哪个领域/项目/主题”，只保留大主题，不保留该主题里的细节。
- 拿不准一律不抽。宁可漏，不可错。

**${timelineTitle}一节**
按时间顺序记录本 session 发生了什么，每个非空条目都必须从消息时间戳提取 YYYY-MM-DD HH:MM 时间标注，不要只写 HH:MM。工作相关内容只允许保留到大主题层级。

## 规则
1. 有已有摘要时：新旧内容合并，同一件事以新信息为准，不要重复
2. 时间标注从消息时间戳提取（YYYY-MM-DD HH:MM 格式）
3. 只记录客观事实，不记录 MOOD 或助手内心想法
4. 用户提供的文件/附件：只记录文件名和用途，忽略文件的具体内容
5. 助手的长篇输出（文章、代码、分析等）：只记录产出了什么，不摘录内容
6. 宁短勿长：摘要长度应与对话的实际信息密度成正比，闲聊几句只需一两行`,
  };
}

function pickAgentName(agentName, lang) {
  if (agentName) return agentName;
  if (lang === "ja") return "この Agent";
  if (lang === "ko") return "이 Agent";
  if (lang === "zh" || lang === "zh-TW") return "这个 Agent";
  return "this agent";
}

function pickUserName(userName, lang) {
  if (userName) return userName;
  if (lang === "ja") return "オーナー";
  if (lang === "ko") return "오너";
  if (lang === "zh" || lang === "zh-TW") return "主人";
  return "the user";
}
