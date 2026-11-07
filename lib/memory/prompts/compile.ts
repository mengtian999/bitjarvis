import { normalizePromptLang, pickPromptText } from "../../../shared/prompt-locale.ts";

export function buildCompileTodayPrompt(locale = "zh-CN") {
  const lang = normalizePromptLang(String(locale || ""));
  return {
    templateVersion: "compile-today.v2",
    cacheGroup: "memory.compile.today",
    systemPrompt: pickPromptText(lang, {
      zh: `你会收到「上一版今日草稿」和「新增或修订的时间线条目（delta）」，请据此更新出一份新的"用户近况与大主题清单"草稿。

处理原则：
- 上一版草稿是今天已经沉淀的内容，默认保留；delta 里标注"取代先前相关记述"的条目，说明对应的旧内容已经过时或不准确，请用它更新/替换草稿里的相关部分，而不是并列保留新旧两种说法
- delta 里没有标注"取代"的条目是今天新发生的事，正常并入
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 每条输出必须保留粗时间锚点，例如"上午"、"07:20 左右"、"傍晚"；不要把时间完全删掉
- 记忆的核心职责是维护用户模型，优先记录用户是谁、喜欢什么、在意什么、最近关注什么
- 工作相关内容只允许保留到大主题层级：只写用户最近关注的领域/项目/主题，不写该主题里的细节

可以记录：
- 用户的身份、人格特质、审美、兴趣、喜欢或讨厌的事物
- 用户最近关注的大主题，例如"记忆系统""Project Jarvis""AI Agent"
- 用户生活、创作、关系或长期关注方向的变化

不要记录：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 具体子问题、具体方案、具体改法、具体测试或发布流程
- 助手具体产出的内容（"生成了一篇关于 X 的文章"够了，不要摘录文章内容）
- 来回修改、重试、被打断又恢复这类过程波动

输出 3-5 条粗颗粒事件，每条 1-2 句。最多 300 字。一天平淡就写得短。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`,
      ja: `「前回の今日ドラフト」と「追加・修正されたタイムラインエントリー（delta）」を受け取ります。それをもとに、新しい「ユーザーの近況と大きなテーマ一覧」ドラフトを更新してください。

処理原則：
- 前回のドラフトは今日すでに定着した内容であり、デフォルトで保持する。delta のうち「以前の関連記述を置き換える」印が付いたエントリーは、対応する旧内容が古いまたは不正確であることを意味する。新旧の記述を並列に残すのではなく、それを使ってドラフトの該当部分を更新・置換すること
- 「置き換え」の印がない delta エントリーは今日新しく起きたことなので、通常どおり統合する
- 同じテーマ/プロジェクトの何度ものある往復は一つの出来事に統合し、逐次の箇条書きにしないこと
- 各出力には粗い時間のアンカー（「午前」「07:20 頃」「夕方」など）を必ず残し、時間を完全に削除しないこと
- 記憶の中核の役割はユーザーモデルの維持である。ユーザーが誰か、何が好きか、何を気にかけているか、最近何に注目しているかを優先的に記録する
- 仕事関連の内容は大きなテーマ階層までしか残せない：ユーザーが最近注目している分野/プロジェクト/テーマのみを書き、そのテーマ内の詳細は書かないこと

記録してよいもの：
- ユーザーのアイデンティティ、人格的特徴、審美観、興味、好き嫌い
- ユーザーが最近注目している大きなテーマ（例：「記憶システム」「Project Jarvis」「AI Agent」）
- ユーザーの生活、創作、人間関係、長期的な関心方向の変化

記録してはいけないもの：
- 実行手順、ファイル名、ツール、コマンド、確認順序、協作の好み、仕事の詳細
- タスク中の方法論の選択、ツールの好み、フォーマット要件、用語ルール
- 具体的な部分問題、具体的な解決策、具体的な修正内容、テストやリリースの流れ
- アシスタントの具体的な成果物の内容（「X についての記事を生成した」で十分。記事の内容を引用しないこと）
- 修正の往復、リトライ、中断と再開といった過程の揺れ

3〜5 件の粗い粒度の出来事を出力し、各 1〜2 文。最大 300 字。平穏な日は短く書くこと。Markdown の見出しを出力せず、#、##、### で始めないこと。本文のリストまたは段落を直接出力すること。`,
      ko: `「이전 버전 오늘 초안」과 「추가 또는 수정된 타임라인 항목(delta)」을 받습니다. 이를 바탕으로 새로운 "사용자 근황과 큰 주제 목록" 초안을 업데이트하세요.

처리 원칙:
- 이전 버전 초안은 오늘 이미 정착된 내용이므로 기본적으로 유지한다. delta에서 "이전 관련 기술을 대체함"으로 표시된 항목은 해당 이전 내용이 낡았거나 부정확하다는 뜻이며, 새것과 옛것을 나란히 두지 말고 이를 사용해 초안의 해당 부분을 갱신/교체할 것
- "대체" 표시가 없는 delta 항목은 오늘 새로 일어난 일이므로 정상적으로 통합한다
- 같은 주제/프로젝트의 여러 번 왕복은 한 건의 사건으로 병합하고, 항목별 나열식으로 쓰지 말 것
- 각 출력 항목에는 반드시 대략적인 시간 앵커("오전", "07:20경", "저녁" 등)를 남기고, 시간을 완전히 지우지 말 것
- 기억의 핵심 역할은 사용자 모델 유지다. 사용자가 누구인지, 무엇을 좋아하는지, 무엇을 신경 쓰는지, 최근 무엇에 관심을 두는지를 우선 기록한다
- 업무 관련 내용은 큰 주제 수준까지만 남길 수 있다: 사용자가 최근 주목하는 분야/프로젝트/주제만 쓰고, 그 주제 안의 세부사항은 쓰지 말 것

기록해도 되는 것:
- 사용자의 정체성, 성격 특성, 심미감, 관심사, 좋아하거나 싫어하는 것
- 사용자가 최근 주목하는 큰 주제(예: "기억 시스템", "Project Jarvis", "AI Agent")
- 사용자의 생활, 창작, 관계 또는 장기 관심 방향의 변화

기록하면 안 되는 것:
- 실행 단계, 파일명, 도구, 명령어, 확인 순서, 협업 선호, 업무 세부사항
- 작업 과정의 방법론 선택, 도구 선호, 포맷 요구사항, 용어 규칙
- 구체적인 하위 문제, 구체적인 방안, 구체적인 수정 내용, 테스트나 배포 절차
- 어시스턴트의 구체적인 산출물 내용("X에 관한 글을 생성했다"로 충분하며, 글 내용을 발췌하지 말 것)
- 수정 왕복, 재시도, 중단 후 재개 같은 과정의 잡음

3-5개의 거친 입자의 사건을 출력하고, 각각 1-2문장. 최대 300자. 평온한 날은 짧게 쓸 것. Markdown 제목을 출력하지 말고 #, ##, ###로 시작하지 말 것. 본문 리스트나 단락을 직접 출력할 것.`,
      fr: `Tu recevras « le brouillon du jour précédent » et « les entrées de timeline ajoutées ou révisées (delta) ». Mets-les à jour en un nouveau brouillon « état actuel de l'utilisateur et grands thèmes ».

Principes de traitement :
- Le brouillon précédent est ce que la journée a déjà consolidé ; conserve-le par défaut. Les entrées du delta marquées « remplace la mention antérieure » signifient que l'ancien contenu correspondant est périmé ou inexact — utilise-les pour mettre à jour / remplacer la partie concernée du brouillon, plutôt que de garder côte à côte les anciennes et nouvelles formulations
- Les entrées du delta sans marque de « remplacement » sont des choses neuves du jour ; intègre-les normalement
- Fusionne les multiples allers-retours sur un même sujet / projet en UN seul événement ; n'énumère pas ligne par ligne
- Chaque élément de sortie doit garder une ancre temporelle grossière, comme « le matin », « vers 07:20 », « le soir » ; ne supprime pas entièrement le temps
- Le rôle central de la mémoire est de maintenir un modèle de l'utilisateur : priorise qui il est, ce qu'il aime, ce qui lui tient à cœur, ce sur quoi il se concentre récemment
- Le contenu professionnel ne peut être conservé qu'au niveau des grands thèmes : écris le domaine / projet / thème suivi récemment, pas les détails à l'intérieur

Peut être enregistré :
- L'identité, les traits de personnalité, l'esthétique, les intérêts, les goûts et aversions de l'utilisateur
- Les grands thèmes récemment suivis par l'utilisateur, comme « systèmes de mémoire », « Project Jarvis », « AI Agent »
- Les changements dans la vie, la création, les relations ou les orientations d'attention de long terme de l'utilisateur

Ne pas enregistrer :
- Étapes d'exécution, noms de fichiers, outils, commandes, ordre de vérification, préférences de collaboration, détails professionnels
- Choix méthodologiques de tâche, préférences d'outils, exigences de format, règles de terminologie
- Sous-problèmes concrets, solutions concrètes, modifications concrètes, tests ou flux de publication
- Le contenu concret des productions de l'assistant (« a rédigé un article sur X » suffit ; ne cite pas l'article)
- Les allers-retours de correction, réessais, interruptions et reprises — bruit de processus

Sors 3 à 5 événements grossiers, 1 à 2 phrases chacun. Maximum 300 caractères. Écris court les jours calmes. Ne sors pas de titres Markdown ; ne commence pas par #, ##, ### ; sors directement une liste ou des paragraphes de texte.`,
      de: `Du erhältst „den heutigen Entwurf der vorherigen Version" und „neue oder überarbeitete Timeline-Einträge (delta)". Aktualisiere sie zu einem neuen Entwurf „aktueller Zustand des Benutzers und große Themen".

Verarbeitungsprinzipien:
- Der vorherige Entwurf ist heute bereits Festgezogenes; behalte ihn standardmäßig. Delta-Einträge mit der Markierung „ersetzt die frühere Angabe" bedeuten, dass der zugehörige alte Inhalt veraltet oder ungenau ist — nutze sie, um den betreffenden Teil des Entwurfs zu aktualisieren / zu ersetzen, statt alte und neue Aussagen nebeneinander stehen zu lassen
- Delta-Einträge ohne „ersetzt"-Markierung sind heute Neues; nimm sie normal auf
- Verschmelze mehrere Hin und Her zum selben Thema / Projekt zu EINEM Ereignis; keine Aufzählung Zeile für Zeile
- Jedes Ausgabeelement muss einen groben Zeitanker behalten, wie „morgens", „um ca. 07:20", „abends"; streiche die Zeit nicht ganz
- Die Kernaufgabe des Speichers ist es, ein Benutzermodell zu pflegen: priorisiere, wer der Benutzer ist, was er mag, was ihm wichtig ist, worauf er sich zuletzt konzentriert
- Arbeitsbezogene Inhalte dürfen nur auf der Ebene der großen Themen bleiben: schreibe das Feld / Projekt / Thema, das den Benutzer zuletzt beschäftigt, nicht die Details darin

Darf aufgezeichnet werden:
- Identität, Persönlichkeitsmerkmale, Ästhetik, Interessen, Vorlieben und Abneigungen des Benutzers
- Große Themen, denen der Benutzer zuletzt folgt, wie „Speichersysteme", „Project Jarvis", „KI-Agenten"
- Veränderungen im Leben, Schaffen, in Beziehungen oder langfristigen Aufmerksamkeitsrichtungen des Benutzers

Nicht aufzeichnen:
- Ausführungsschritte, Dateinamen, Werkzeuge, Befehle, Prüfreihenfolge, Kollaborationspräferenzen, Arbeitsdetails
- Methodenwahl während der Aufgabe, Werkzeugpräferenzen, Formatanforderungen, Terminologieregeln
- Konkrete Teilprobleme, konkrete Lösungen, konkrete Änderungen, Tests oder Release-Abläufe
- Konkrete Inhalte der Ausgaben des Assistenten („hat einen Artikel über X geschrieben" genügt; den Artikel nicht auszugsweise zitieren)
- Korrektur-Hin und Her, Wiederholungsversuche, Unterbrechungen und Fortsetzungen — Prozessrauschen

Gib 3-5 grobe Ereignisse aus, je 1-2 Sätze. Maximal 300 Zeichen. An ruhigen Tagen kurz schreiben. Keine Markdown-Überschriften ausgeben, nicht mit #, ##, ### beginnen; direkt Textliste oder Absatz ausgeben.`,
      en: `You will receive the "previous today draft" and "new or revised timeline entries (delta)". Update them into a new "user-current-state and broad-theme list" draft.

Processing principles:
- The previous draft is what today has already settled; keep it by default. Delta entries marked "supersedes prior mention" mean the corresponding old content is outdated or inaccurate — use them to update/replace the related part of the draft rather than keeping both the old and new statements side by side
- Delta entries without a "supersedes" marker are new things that happened today; merge them in normally
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Each output item must keep a coarse time anchor, such as "morning", "around 07:20", or "evening"; do not remove time entirely
- Memory's core job is to maintain a user model: prioritize who the user is, what they like, what they care about, and what they are broadly focused on recently
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme

May record:
- The user's identity, personality traits, aesthetics, interests, likes, and dislikes
- Broad themes the user is currently focused on, such as "memory systems", "Project Jarvis", or "AI Agent"
- Changes in the user's life, creative work, relationships, or long-term areas of attention

Do NOT record:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Specific content of assistant's output ("wrote an article about X" is enough; do not excerpt the article)
- Revisions, retries, interruptions and resumptions — these are process noise

Output 3-5 coarse events, 1-2 sentences each. Max 180 words. Keep it short on quiet days. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    }),
  };
}

export function buildCompileDailyPrompt(locale = "zh-CN") {
  const lang = normalizePromptLang(String(locale || ""));
  return {
    templateVersion: "compile-daily.v2",
    cacheGroup: "memory.compile.daily",
    systemPrompt: pickPromptText(lang, {
      zh: `你会收到这一天的时间线条目或最终版"今日草稿"（当天结束时对用户近况的整理稿），请把它蒸馏成两三句话的简短日记条目。

关键定位：这是给一周概览用的一条记录，不是详细日志。读的人只需要一眼看出这一天大致发生了什么、用户在关注什么。

提炼原则：
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 保留这一天的粗时间感，例如"上午"、"傍晚"或一个代表性 HH:MM；不要写成无时间锚点的主题标签
- 记忆的核心职责是维护用户模型：优先记录用户是谁、喜欢什么、在意什么、这天关注什么
- 工作相关内容只允许保留到大主题层级：只写用户这天关注的领域/项目/主题，不写该主题里的细节

不要记录：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 具体子问题、具体方案、具体改法、具体测试或发布流程
- 助手具体产出的内容
- 来回修改、重试、被打断又恢复这类过程波动

只输出两三句话，最多 60 字。这天平淡就写得更短。不要输出日期抬头（调用方会自行加上日期），不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文。`,
      ja: `この日のタイムラインエントリーまたは最終版の「今日ドラフト」（当日終了時のユーザー近況のまとめ）を受け取ります。それを二〜三文の短い日記エントリーに蒸留してください。

重要な位置づけ：これは週概観のための 1 レコードであり、詳細ログではない。読む人は、この日に大まかに何が起きたか、ユーザーが何に注目していたかを一目でわかればよい。

蒸留の原則：
- 同じテーマ/プロジェクトの何度ものある往復は一つの出来事に統合し、逐次の箇条書きにしないこと
- この日の粗い時間感覚（「午前」「夕方」、代表的な HH:MM など）を残すこと。時間アンカーのないテーマラベルにしないこと
- 記憶の中核の役割はユーザーモデルの維持：ユーザーが誰か、何が好きか、何を気にかけているか、この日何に注目していたかを優先的に記録する
- 仕事関連の内容は大きなテーマ階層までしか残せない：ユーザーがこの日注目した分野/プロジェクト/テーマのみを書き、そのテーマ内の詳細は書かないこと

記録してはいけないもの：
- 実行手順、ファイル名、ツール、コマンド、確認順序、協作の好み、仕事の詳細
- タスク中の方法論の選択、ツールの好み、フォーマット要件、用語ルール
- 具体的な部分問題、具体的な解決策、具体的な修正内容、テストやリリースの流れ
- アシスタントの具体的な成果物の内容
- 修正の往復、リトライ、中断と再開といった過程の揺れ

二〜三文のみを出力し、最大 60 字。平穏な日はもっと短く書くこと。日付の見出しは出力せず（呼び出し側が日付を付ける）、Markdown の見出しを出力せず、#、##、### で始めないこと。本文を直接出力すること。`,
      ko: `이 날의 타임라인 항목 또는 최종 버전 "오늘 초안"(하루를 마칠 때 정리한 사용자 근황)을 받습니다. 이를 두세 문장의 짧은 일기 항목으로 증류하세요.

핵심 위치: 이것은 주간 개요에 쓰이는 한 항목이지 상세 로그가 아니다. 읽는 사람은 이 날 대략 무슨 일이 있었고 사용자가 무엇에 주목했는지만 한눈에 알면 된다.

증류 원칙:
- 같은 주제/프로젝트의 여러 번 왕복은 한 건의 사건으로 병합하고, 항목별 나열식으로 쓰지 말 것
- 이 날의 대략적인 시간감("오전", "저녁", 대표적인 HH:MM 등)을 남길 것. 시간 앵커 없는 주제 라벨로 쓰지 말 것
- 기억의 핵심 역할은 사용자 모델 유지: 사용자가 누구인지, 무엇을 좋아하는지, 무엇을 신경 쓰는지, 이 날 무엇에 주목했는지를 우선 기록한다
- 업무 관련 내용은 큰 주제 수준까지만 남길 수 있다: 사용자가 이 날 주목한 분야/프로젝트/주제만 쓰고, 그 주제 안의 세부사항은 쓰지 말 것

기록하면 안 되는 것:
- 실행 단계, 파일명, 도구, 명령어, 확인 순서, 협업 선호, 업무 세부사항
- 작업 과정의 방법론 선택, 도구 선호, 포맷 요구사항, 용어 규칙
- 구체적인 하위 문제, 구체적인 방안, 구체적인 수정 내용, 테스트나 배포 절차
- 어시스턴트의 구체적인 산출물 내용
- 수정 왕복, 재시도, 중단 후 재개 같은 과정의 잡음

두세 문장만 출력하고 최대 60자. 평온한 날은 더 짧게 쓸 것. 날짜 머리말을 출력하지 말고(호출자가 날짜를 붙임), Markdown 제목을 출력하지 말며 #, ##, ###로 시작하지 말 것. 본문을 직접 출력할 것.`,
      fr: `Tu recevras les entrées de timeline de la journée ou le « brouillon du jour » final (la synthèse de l'état de l'utilisateur rédigée en fin de journée). Distille-les en une courte entrée de journal de deux à trois phrases.

Positionnement clé : c'est une entrée qui alimente la vue hebdomadaire, pas un journal détaillé. Le lecteur doit voir d'un coup d'œil ce qui s'est grossièrement passé ce jour-là et ce à quoi l'utilisateur s'intéressait.

Principes de distillation :
- Fusionne les multiples allers-retours sur un même sujet / projet en UN seul événement ; n'énumère pas ligne par ligne
- Conserve le sens grossier du temps de la journée, comme « le matin », « le soir » ou un HH:MM représentatif ; n'en fais pas des étiquettes de sujet sans ancre temporelle
- Le rôle central de la mémoire est de maintenir un modèle de l'utilisateur : priorise qui il est, ce qu'il aime, ce qui lui tient à cœur, ce sur quoi il s'est concentré ce jour-là
- Le contenu professionnel ne peut être conservé qu'au niveau des grands thèmes : écris le domaine / projet / thème suivi ce jour-là, pas les détails à l'intérieur

Ne pas enregistrer :
- Étapes d'exécution, noms de fichiers, outils, commandes, ordre de vérification, préférences de collaboration, détails professionnels
- Choix méthodologiques de tâche, préférences d'outils, exigences de format, règles de terminologie
- Sous-problèmes concrets, solutions concrètes, modifications concrètes, tests ou flux de publication
- Le contenu concret des productions de l'assistant
- Les allers-retours de correction, réessais, interruptions et reprises — bruit de processus

Sors seulement deux à trois phrases, 60 caractères max. Écris encore plus court les jours calmes. Ne sors pas d'en-tête de date (l'appelant ajoute la date), pas de titres Markdown ; ne commence pas par #, ##, ### ; sors directement le texte.`,
      de: `Du erhältst die Timeline-Einträge des Tages oder den endgültigen „heutigen Entwurf" (die End-Tages-Zusammenfassung des Benutzerzustands). Destilliere sie zu einem kurzen Tagebucheintrag von zwei bis drei Sätzen.

Wichtige Einordnung: Das ist ein Eintrag für die Wochenübersicht, kein detailliertes Protokoll. Der Leser braucht nur auf einen Blick zu sehen, was an diesem Tag grob geschah und worauf der Benutzer fokussiert war.

Destillationsprinzipien:
- Verschmelze mehrere Hin und Her zum selben Thema / Projekt zu EINEM Ereignis; keine Aufzählung Zeile für Zeile
- Bewahre das grobe Zeitgefühl des Tages, wie „morgens", „abends" oder eine repräsentative HH:MM-Angabe; mach daraus keine zeitlosen Themenetiketten
- Die Kernaufgabe des Speichers ist es, ein Benutzermodell zu pflegen: priorisiere, wer der Benutzer ist, was er mag, was ihm wichtig ist, worauf er an diesem Tag fokussiert war
- Arbeitsbezogene Inhalte dürfen nur auf der Ebene der großen Themen bleiben: schreibe das Feld / Projekt / Thema des Tages, nicht die Details darin

Nicht aufzeichnen:
- Ausführungsschritte, Dateinamen, Werkzeuge, Befehle, Prüfreihenfolge, Kollaborationspräferenzen, Arbeitsdetails
- Methodenwahl während der Aufgabe, Werkzeugpräferenzen, Formatanforderungen, Terminologieregeln
- Konkrete Teilprobleme, konkrete Lösungen, konkrete Änderungen, Tests oder Release-Abläufe
- Konkrete Inhalte der Ausgaben des Assistenten
- Korrektur-Hin und Her, Wiederholungsversuche, Unterbrechungen und Fortsetzungen — Prozessrauschen

Gib nur zwei bis drei Sätze aus, maximal 60 Zeichen. An ruhigen Tagen noch kürzer. Keine Datumsüberschrift ausgeben (der Aufrufer fügt das Datum hinzu), keine Markdown-Überschriften, nicht mit #, ##, ### beginnen; direkt Text ausgeben.`,
      en: `You will receive that day's timeline entries or final "today draft" (the end-of-day writeup of the user's current state). Distill it into a short two-to-three sentence diary entry.

Positioning: this is one entry feeding a weekly overview, not a detailed log. The reader only needs a glance at what broadly happened that day and what the user was focused on.

Principles:
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Preserve the day's coarse sense of time, such as "morning", "evening", or one representative HH:MM; do not turn it into timeless topic labels
- Memory's core job is to maintain a user model: prioritize who the user is, what they like, what they care about, and what they focused on that day
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme

Do NOT record:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Specific content of assistant's output
- Revisions, retries, interruptions and resumptions — these are process noise

Output only two to three sentences, max 30 words. Keep it shorter on quiet days. Do not output a date heading (the caller adds the date). Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    }),
  };
}

export function buildCompileLongtermPrompt(locale = "zh-CN") {
  const lang = normalizePromptLang(String(locale || ""));
  return {
    templateVersion: "compile-longterm.v1",
    cacheGroup: "memory.compile.longterm",
    systemPrompt: pickPromptText(lang, {
      zh: `请综合「上一份长期情况」和「新沉淀内容」，重写成一份新的长期情况。必须控制在 400 字以内。

记忆不是工作日志，也不是协作手册。到 longterm 这一层，记录已经是最稳定的用户画像核心。只保留"如果一年后回看仍然适合用来理解用户这个人"的内容：
- 用户的身份、人格特质、审美、兴趣、价值取向
- 用户长期喜欢或讨厌的事物
- 用户长期关系和稳定生活背景
- 用户持续关注或投入的长期关注方向

去掉这些"单次性内容"：
- 某天/某周完成的具体任务
- 用户偏好的工作方式、协作流程、工程纪律
- 工具使用习惯、检查顺序、汇报格式
- 某类任务的处理方法
- 助手的具体产出内容
- 任何"这周/那周"级别的细节

处理方式：
- 不要追加，不要把旧内容和新内容分开复述
- 必须做取舍、抽象、合并，把重复或过细的信息压成更高层概括
- 如果上一份长期情况已经很长，优先概括旧内容，再吸收真正重要的新内容

不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`,
      ja: `「前回の長期状況」と「新しく定着した内容」を統合し、新しい長期状況として書き直してください。必ず 400 字以内に収めること。

記憶は作業ログでも協作マニュアルでもない。longterm の層に達した記録は、最も安定したユーザー像の中核である。「1 年後に振り返ってもユーザーという人間を理解するのにふさわしい内容」だけを残すこと：
- ユーザーのアイデンティティ、人格的特徴、審美観、興味、価値観
- ユーザーが長期にわたって好きまたは嫌いなもの
- 長期的な人間関係と安定した生活背景
- 継続的に注目または投資している長期的な関心方向

次のような「単発的な内容」は取り除くこと：
- 特定の日/週に完了した具体的なタスク
- ユーザーが好む仕事の進め方、協作の流れ、エンジニアリング規律
- ツールの使用習慣、確認順序、報告フォーマット
- ある種類のタスクの処理方法
- アシスタントの具体的な成果物の内容
- 「今週/あの週」レベルの細かいものすべて

処理のしかた：
- 追加するのではなく、旧内容と新内容を別々に述べ直さないこと
- 取捨選択・抽象化・統合を行い、繰り返しや細かすぎる情報をより高いレベルの概括に圧縮すること
- 前回の長期状況がすでに長い場合は、まず旧内容を概括し、その後で本当に重要な新内容を吸収すること

Markdown の見出しを出力せず、#、##、### で始めないこと。本文のリストまたは段落を直接出力すること。`,
      ko: `「이전 장기 상황」과 「새로 정착된 내용」을 종합하여 새로운 장기 상황으로 다시 작성하세요. 반드시 400자 이내로 유지할 것.

기억은 업무 로그도 협업 매뉴얼도 아니다. longterm 계층에 이른 기록은 가장 안정적인 사용자 프로필의 핵심이다. "1년 후에 돌아봐도 사용자라는 사람을 이해하는 데 여전히 적합한 내용"만 남길 것:
- 사용자의 정체성, 성격 특성, 심미감, 관심사, 가치 지향
- 사용자가 오랫동안 좋아하거나 싫어한 것
- 장기적인 관계와 안정적인 생활 배경
- 지속적으로 주목하거나 몰두하는 장기 관심 방향

다음과 같은 "일회성 내용"은 제거할 것:
- 특정 날/주에 완료한 구체적인 작업
- 사용자가 선호하는 업무 방식, 협업 절차, 엔지니어링 규율
- 도구 사용 습관, 확인 순서, 보고 포맷
- 특정 유형 작업의 처리 방법
- 어시스턴트의 구체적인 산출물 내용
- "이번 주/그 주" 수준의 모든 세부사항

처리 방식:
- 추가하지 말고, 이전 내용과 새 내용을 나누어 서술하지 말 것
- 취사선택, 추상화, 병합을 수행하여 반복되거나 지나치게 세밀한 정보를 더 높은 수준의 개괄로 압축할 것
- 이전 장기 상황이 이미 길다면 우선 이전 내용을 개괄한 뒤, 진정으로 중요한 새 내용을 흡수할 것

Markdown 제목을 출력하지 말고 #, ##, ###로 시작하지 말 것. 본문 리스트나 단락을 직접 출력할 것.`,
      fr: `Synthétise « la situation long terme précédente » et « le contenu nouvellement consolidé », puis réécris-les en une nouvelle situation long terme. Le résultat doit tenir sous 400 caractères.

La mémoire n'est ni un journal de travail ni un manuel de collaboration. Au niveau longterm, l'enregistrement est le cœur le plus stable du portrait de l'utilisateur. Ne garde que ce qui servirait encore à comprendre l'utilisateur comme personne « si on le relisait dans un an » :
- L'identité, les traits de personnalité, l'esthétique, les intérêts et les valeurs de l'utilisateur
- Ce que l'utilisateur aime ou n'aime pas depuis longtemps
- Les relations durables et le cadre de vie stable de l'utilisateur
- Les orientations d'attention long terme suivies ou investies durablement par l'utilisateur

Retire ces contenus « à usage unique » :
- Les tâches concrètes accomplies un jour ou une semaine donnés
- La façon de travailler préférée de l'utilisateur, les flux de collaboration, la discipline d'ingénierie
- Les habitudes d'outils, l'ordre de vérification, le format des comptes rendus
- La méthode de traitement d'une classe de tâches
- Le contenu concret des productions de l'assistant
- Tout détail de niveau « cette semaine / cette semaine-là »

Mode de traitement :
- N'ajoute pas ; ne reformule pas séparément l'ancien et le nouveau contenu
- Fais des choix, abstrais, fusionne ; compresse les répétitions et les détails trop fins en synthèses de plus haut niveau
- Si la situation long terme précédente est déjà longue, résume d'abord l'ancien contenu, puis absorbe seulement le nouveau contenu vraiment important

Ne sors pas de titres Markdown ; ne commence pas par #, ##, ### ; sors directement une liste ou des paragraphes de texte.`,
      de: `Synthetisiere „den vorherigen Langzeitkontext" und „den neu festgezogenen Inhalt" und schreibe sie als einen neuen Langzeitkontext neu. Das Ergebnis muss unter 400 Zeichen bleiben.

Speicher ist weder ein Arbeitsprotokoll noch ein Kollaborationshandbuch. Auf der longterm-Ebene ist der Eintrag der stabilste Kern des Benutzerporträts. Behalte nur, was auch „beim Rückblick in einem Jahr" noch hilft, den Benutzer als Person zu verstehen:
- Identität, Persönlichkeitsmerkmale, Ästhetik, Interessen und Wertorientierung des Benutzers
- Was der Benutzer langfristig mag oder ablehnt
- Langfristige Beziehungen und stabiler Lebenshintergrund des Benutzers
- Von ihm dauerhaft verfolgte oder investierte langfristige Aufmerksamkeitsrichtungen

Entferne diese „Einmaleinhalte":
- Konkrete Aufgaben, die an einem bestimmten Tag / einer bestimmten Woche erledigt wurden
- Die bevorzugte Arbeitsweise des Benutzers, Kollaborationsabläufe, Ingenieurdisziplin
- Werkzeuggewohnheiten, Prüfreihenfolge, Berichtsformat
- Die Behandlungsmethode einer Aufgabenklasse
- Konkrete Inhalte der Ausgaben des Assistenten
- Alle Details der Ebene „diese Woche / jene Woche"

Verarbeitungsweise:
- Hänge nichts an; stelle alten und neuen Inhalt nicht getrennt dar
- Triff Auswahlen, abstrahiere, verschmelze; komprimiere Wiederholungen und zu feine Details zu höherstufigen Zusammenfassungen
- Ist der vorherige Langzeitkontext bereits lang, fasse zuerst den alten Inhalt zusammen und nehme dann nur wirklich wichtige neue Inhalte auf

Gib keine Markdown-Überschriften aus, beginne nicht mit #, ##, ###; gib direkt eine Textliste oder Absätze aus.`,
      en: `Synthesize "Previous long-term context" and "Newly settled content", then rewrite them into one new long-term context. You must keep the result under 240 words.

Memory is not a work log or collaboration manual. At the longterm layer, the record is the most stable user-profile core. Keep only what would still help understand the user as a person "if reviewed a year from now":
- The user's identity, personality traits, aesthetics, interests, and values
- Things the user has long liked or disliked
- Long-term relationships and stable life background
- Persistent long-term focus directions

Remove these "one-off" contents:
- Specific tasks completed on a particular day or week
- User-preferred work style, collaboration process, or engineering discipline
- Tool habits, validation order, report format
- How to handle a class of task
- Specific content of assistant's output
- Any "this week / that week" level details

How to process:
- Do not append; do not restate old and new content separately
- Make tradeoffs, abstract, and merge; compress repeated or overly specific details into higher-level facts
- If the previous long-term context is already long, summarize it first, then absorb only genuinely important new content

Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    }),
  };
}

export function buildCompileEditableFactsPrompt(locale = "zh-CN") {
  const lang = normalizePromptLang(String(locale || ""));
  return {
    templateVersion: "compile-editable-facts.v1",
    cacheGroup: "memory.compile.editable_facts",
    systemPrompt: pickPromptText(lang, {
      zh: "请综合「当前可信 Facts」和「新增候选 Facts」，重写成一份新的重要事实。必须控制在 200 字以内，宁可概括合并，也不要堆叠罗列。当前可信 Facts 代表用户或 Agent 已确认过的稳定信息，默认作为基础，但如果过长，必须压成更高层概括；新增候选 Facts 只在能纠正、补充或更新稳定用户画像时吸收。只保留稳定的、跨时间有效的用户画像：身份、人格特质、审美、兴趣、喜欢或讨厌的事物、长期关系、长期关注方向。新增候选 Facts 与当前可信 Facts 冲突时，以新增候选 Facts 修正当前事实。不要追加，不要把两部分分别复述。不要保留工作方式、协作流程、工具偏好、执行细节。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。",
      ja: "「現在の信頼できる Facts」と「新しい候補 Facts」を統合し、新しい重要事実として書き直してください。必ず 200 字以内に収め、積み重ねた列挙よりも簡潔な概括と統合を優先すること。現在の信頼できる Facts はユーザーまたは Agent が確認済みの安定情報であり、デフォルトで基礎とするが、長すぎる場合はより高いレベルの概括に圧縮しなければならない。新しい候補 Facts は、安定したユーザー像を修正・補完・更新できる場合にのみ取り込むこと。安定しており時間を越えて有効なユーザー像のみを残す：アイデンティティ、人格的特徴、審美観、興味、好き嫌い、長期的な人間関係、長期的な関心方向。新しい候補 Facts が現在の信頼できる Facts と矛盾する場合は、新しい候補 Facts で現行事実を修正すること。追加書き込みをせず、2 つの入力を別々に述べ直さないこと。仕事の進め方、協作の流れ、ツールの好み、実行の詳細は残さないこと。Markdown の見出しを出力せず、#、##、### で始めないこと。本文のリストまたは段落を直接出力すること。",
      ko: "「현재 신뢰할 수 있는 Facts」와 「새로운 후보 Facts」를 종합하여 새로운 중요 사실로 다시 작성하세요. 반드시 200자 이내로 유지하고, 쌓아 나열하기보다 간결한 개괄과 병합을 우선할 것. 현재 신뢰할 수 있는 Facts는 사용자나 Agent가 확인한 안정적인 정보로 기본적으로 기반이 되지만, 너무 길다면 더 높은 수준의 개괄으로 압축해야 한다. 새로운 후보 Facts는 안정적인 사용자 프로필을 교정·보완·갱신할 수 있을 때만 흡수할 것. 안정적이고 시간을 넘어 유효한 사용자 프로필만 남길 것: 정체성, 성격 특성, 심미감, 관심사, 좋아하거나 싫어하는 것, 장기 관계, 장기 관심 방향. 새로운 후보 Facts가 현재 신뢰할 수 있는 Facts와 충돌하면 새로운 후보 Facts로 현행 사실을 교정할 것. 추가하지 말고, 두 입력을 나누어 서술하지 말 것. 업무 방식, 협업 절차, 도구 선호, 실행 세부사항은 남기지 말 것. Markdown 제목을 출력하지 말고 #, ##, ###로 시작하지 말 것. 본문 리스트나 단락을 직접 출력할 것.",
      fr: "Synthétise « les faits fiables actuels » et « les nouveaux faits candidats », puis réécris-les en une nouvelle section de faits clés. Le résultat doit tenir sous 200 caractères ; préfère la synthèse concise et la fusion à l'empilement de listes. Les faits fiables actuels sont des informations stables confirmées par l'utilisateur ou l'Agent et forment la base ; s'ils sont trop longs, compresse-les en faits de plus haut niveau. N'absorbe les nouveaux faits candidats que s'ils corrigent, complètent ou actualisent le portrait stable de l'utilisateur. Ne garde que les faits stables et valables dans le temps : identité, traits de personnalité, esthétique, intérêts, goûts et aversions, relations durables, orientations d'attention long terme. Quand les nouveaux faits candidats contredisent les faits fiables actuels, corrige les faits actuels avec eux. N'ajoute pas ; ne reformule pas les deux entrées séparément. Ne conserve pas la façon de travailler, les flux de collaboration, les préférences d'outils ni les détails d'exécution. Ne sors pas de titres Markdown ; ne commence pas par #, ##, ### ; sors directement une liste ou des paragraphes de texte.",
      de: "Synthetisiere „die aktuell vertrauenswürdigen Fakten“ und „die neuen Kandidaten-Fakten“ und schreibe sie als einen neuen Kernfakten-Abschnitt neu. Das Ergebnis muss unter 200 Zeichen bleiben; bevorzuge knappe Zusammenfassung und Verschmelzung statt gestapelter Aufzählungen. Die aktuell vertrauenswürdigen Fakten sind vom Benutzer oder Agenten bestätigte stabile Informationen und bilden die Basis; sind sie zu lang, komprimiere sie zu höherstufigen Fakten. Nehme neue Kandidaten-Fakten nur auf, wenn sie das stabile Benutzerporträt korrigieren, ergänzen oder aktualisieren. Behalte nur stabile, zeitübergreifend gültige Benutzerprofil-Fakten: Identität, Persönlichkeitsmerkmale, Ästhetik, Interessen, Vorlieben und Abneigungen, langfristige Beziehungen, langfristige Aufmerksamkeitsrichtungen. Widersprechen neue Kandidaten-Fakten den aktuell vertrauenswürdigen, korrigiere die aktuellen Fakten mit ihnen. Hänge nichts an; stelle die beiden Eingaben nicht getrennt dar. Behalte keine Arbeitsweise, Kollaborationsabläufe, Werkzeugpräferenzen oder Ausführungsdetails. Gib keine Markdown-Überschriften aus, beginne nicht mit #, ##, ###; gib direkt eine Textliste oder Absätze aus.",
      en: "Synthesize \"Current Trusted Facts\" and \"New Candidate Facts\", then rewrite them into one new Key Facts section. You must keep the result under 120 words; prefer concise abstraction and merging over stacked lists. Current Trusted Facts are stable information confirmed by the user or agent and are the base, but if they are too long, compress them into higher-level facts. Absorb New Candidate Facts only when they correct, supplement, or update stable user-profile information. Keep only stable, time-persistent user-profile facts: identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, and long-term focus directions. When New Candidate Facts conflict with Current Trusted Facts, use them to correct the current facts. Do not append. Do not restate the two inputs separately. Do not keep work style, collaboration process, tool preferences, or execution details. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.",
    }),
  };
}
