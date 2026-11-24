import type { ResolvedInterfaceLanguage } from "@bb/domain";

export type InterfaceTranslator = (
  message: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

const russian = new Map<string, string>(
  Object.entries({
    Configuration: "Настройки",
    "Plugin details": "О плагине",
    "Enable {plugin}": "Включить {plugin}",
    "Disable {plugin}": "Отключить {plugin}",
    "Loading plugin settings…": "Загрузка настроек плагина…",
    "Could not load plugin settings.":
      "Не удалось загрузить настройки плагина.",
    "This plugin is not installed.": "Этот плагин не установлен.",
    "Settings are unavailable while the plugin is {status}.":
      "Настройки недоступны, пока плагин имеет статус {status}.",
    "Enable this plugin to edit its settings.":
      "Включи плагин, чтобы изменить его настройки.",
    "Could not save this setting": "Не удалось сохранить настройку",
    "Enter a finite number": "Введи конечное число",
    "Select…": "Выбрать…",
    "Select a project…": "Выбрать проект…",
    "[set]": "[сохранён]",
    "[not set]": "[не задан]",
    secret: "секрет",
    "in {count}s": "через {count} с",
    "in {count}m": "через {count} мин",
    "in {count}h": "через {count} ч",
    "in {count}d": "через {count} дн",
    "Queued message": "Сообщение в очереди",
    "Resume after bb restarted": "Продолжение после перезапуска bb",
    "Retry failed turn from {time}": "Повтор неудачного запроса от {time}",
    "Not sent · a newer message was sent after it":
      "Не отправлено · более новое сообщение уже отправлено",
    "held by {plugin} · {reason}": "приостановлено: {plugin} · {reason}",
    "Held by {plugin} · {reason}": "Приостановлено: {plugin} · {reason}",
    "resuming at {time}": "продолжение: {time}",
    "retrying at {time}": "повтор: {time}",
    "attempt {number}": "попытка {number}",
    "Turn didn't start · sends on the next turn":
      "Ход не начался · отправится в следующем ходе",
    "Waiting for turn to start": "Ожидание начала хода",
    "Sending when the thread stops": "Отправится после остановки диалога",
    Scheduled: "Запланировано",
    "Scheduled for {time}": "Отправка: {time}",
    "Waiting for workspace": "Ожидание рабочей папки",
    "Waiting for {host} to be ready": "Ожидание готовности {host}",
    "Waiting for your reply": "Ожидание твоего ответа",
    "Sending after bb restarts to update":
      "Отправится после перезапуска и обновления bb",
    "Tomorrow {time}": "Завтра {time}",

    "Message queue": "Очередь",
    "Loading queued messages": "Загрузка очереди",
    "Queued messages": "Сообщения в очереди",
    "Toggle queued messages": "Развернуть очередь",
    "Collapse queued messages": "Свернуть очередь",
    "Send now": "Отправить сейчас",
    "Steer when ready": "Направить агенту, когда будет готов",
    "Steer queued message {number} when ready":
      "Направить сообщение {number} из очереди агенту, когда будет готов",
    "Send queued message {number} now":
      "Отправить сообщение {number} из очереди сейчас",
    "Reorder queued message {number}":
      "Переместить сообщение {number} в очереди",
    "Edit queued message {number}": "Изменить сообщение {number} в очереди",
    "Change when queued message {number} sends":
      "Изменить время отправки сообщения {number} из очереди",
    "Delete queued message {number}": "Удалить сообщение {number} из очереди",
    "Queued message {number} actions":
      "Действия с сообщением {number} в очереди",
    "Messages above send together": "Сообщения выше отправятся вместе",
    "Stop editing queued message":
      "Закончить редактирование сообщения в очереди",
    "Editing queued message {number}":
      "Редактирование сообщения {number} в очереди",
    "Editing…": "Редактирование…",
    "Deleting…": "Удаление…",
    "Sending…": "Отправка…",
    Edit: "Изменить",
    Delete: "Удалить",
    "Change send time": "Изменить время отправки",
    "1 attachment": "1 вложение",
    "{count} attachments": "Вложения: {count}",
    "From {sender}": "Отправитель: {sender}",
    From: "Отправитель:",
    "{count} from bb": "от bb: {count}",

    "Wait for tasks to succeed": "Дождаться успешного завершения заданий",
    "Failed or cancelled tasks keep this task waiting. You can change its dependencies later.":
      "При ошибке или отмене предшественника это задание продолжит ждать. Зависимости можно изменить позже.",
    "No other queued tasks": "Других заданий в очереди нет",
    "Dependencies: {count}": "Зависимости: {count}",
    "Waiting for task {id} to succeed ({status})":
      "Ожидание успешного завершения задания {id} ({status})",
    queued: "в очереди",
    running: "выполняется",
    failed: "ошибка",
    cancelled: "отменено",

    "Assign task model": "Назначить модель заданию",
    "Queue with model": "В очередь с моделью",
    "Queue requests with different models": "Очередь с разными моделями",
    "Choose a model for this queued request.":
      "Выбери модель для этого задания.",
    "Show more": "Показать полностью",
    "Show less": "Свернуть",
    "Add to queue": "Добавить в очередь",
    "Saving…": "Сохранение…",
    "Could not save this queued task.": "Не удалось сохранить задание очереди.",
    "Type a message before adding it to the queue.":
      "Введи сообщение перед добавлением в очередь.",
    "Add the current draft and its attachments to the queue with this model. It may start immediately when the conversation is idle. Otherwise, it waits for the current turn.":
      "Добавить текущий черновик и вложения в очередь с выбранной моделью. В свободном диалоге задание может запуститься сразу. Во время работы агента оно дождётся завершения хода.",
    "Automatic switch": "Автопереключение",
    "Model for this queued task": "Модель для этого задания очереди",
    "Save the editor to keep this assignment. Choose whether this task may switch providers when it starts. Otherwise, return to its provider manually.":
      "Сохрани изменения в редакторе, чтобы оставить назначение. Выбери, может ли задание само сменить провайдера при запуске. Без этого вернись к его провайдеру вручную.",
    "Switch automatically when this task starts":
      "Переключать провайдера при запуске задания",
    "When another provider is active, transfer recent visible messages with a context budget of up to 8192 tokens, also limited by the model catalog. Earlier messages may be omitted. The task waits for the current turn to finish.":
      "Если выбран другой провайдер, передать последние видимые сообщения с бюджетом контекста до 8192 токенов и дополнительным ограничением по каталогу модели. Ранние сообщения могут не войти. Задание дождётся завершения текущего хода.",
    "Could not verify the target model catalog.":
      "Не удалось проверить каталог целевой модели.",
    "Use for this task": "Использовать для задания",
    "Service tier": "Режим обслуживания",
    "Switch model in this conversation": "Сменить модель в этом диалоге",
    "Select a model to review switching in this conversation.":
      "Выбери модель, чтобы посмотреть условия переключения в этом диалоге.",
    "A ready workspace and idle conversation are required to switch providers.":
      "Для смены провайдера нужна готовая рабочая папка и диалог без активной работы.",
    "Keep this chat and workspace. Review the context before a fresh agent session is prepared.":
      "Диалог и рабочая папка сохранятся. Проверь передаваемый контекст перед подготовкой новой сессии агента.",
    Provider: "Провайдер",
    Model: "Модель",
    Permissions: "Разрешения",
    "Choose permissions": "Выбери разрешения",
    "Full access": "Полный доступ",
    "Automatic approval": "Автоматическое подтверждение",
    "Approve commands": "Подтверждать команды",
    Reasoning: "Обдумывание",
    "Model default": "Как задано у модели",
    "Use my summary instead of recent messages":
      "Передать мою сводку вместо последних сообщений",
    "Conversation summary": "Сводка диалога",
    "Context budget": "Размер передаваемого контекста",
    "Conservative transfer budget": "Осторожная оценка бюджета передачи",
    "User-declared context window (optional)":
      "Окно контекста, указанное тобой (необязательно)",
    "Preparing preview…": "Подготовка предпросмотра…",
    "Preview context": "Посмотреть контекст",
    "Only the text below will be transferred. Reasoning, tool results and attachment contents are excluded.":
      "Будет передан только текст ниже. Рассуждения, результаты инструментов и содержимое вложений исключены.",
    "Recognized credentials are redacted. Review this partial context before sharing it.":
      "Распознанные ключи и пароли скрыты. Проверь этот неполный контекст перед передачей.",
    "Conservative estimate: {tokens}; messages: {messages}.":
      "Осторожная оценка: {tokens} токенов; сообщений: {messages}.",
    "The target context window is unknown.":
      "Окно контекста целевой модели неизвестно.",
    "Declared window: {tokens} ({source}).":
      "Заявленное окно: {tokens} ({source}).",
    "The actual serving window is unverified; room is reserved for instructions, tools and the answer.":
      "Фактическое окно сервера не проверено; оставлен запас для инструкций, инструментов и ответа.",
    "Context to transfer": "Передаваемый контекст",
    "Switching…": "Переключение…",
    "Switch in this conversation": "Переключить в этом диалоге",
    "Change selection": "Изменить выбор",
    "The model was switched.": "Модель переключена.",
    "The previous provider was retained.": "Прежний провайдер сохранён.",
    "Waiting for the switch result": "Ожидание результата переключения",
    "Operation details": "Сведения об операции",
    "Check and recover": "Проверить и восстановить",
    "Review a new switch": "Подготовить новый переход",
    "Could not prepare the context preview.":
      "Не удалось подготовить предпросмотр контекста.",
    "The switch failed. The previous provider was retained.":
      "Переключение не удалось. Прежний провайдер сохранён.",
    "The connection was interrupted. Check the saved operation below.":
      "Соединение прервано. Проверь сохранённую операцию ниже.",
    "Recovery is waiting for the executor.":
      "Восстановление ждёт подключения исполнителя.",
    "The model catalog could not be loaded. Check the provider connection.":
      "Не удалось загрузить каталог моделей. Проверь подключение провайдера.",
    provider: "каталог провайдера",
    user: "указано тобой",
    unknown: "неизвестно",
    Settings: "Настройки",
    General: "Основные",
    Providers: "Провайдеры",
    "AI services": "Сервисы ИИ",
    Appearance: "Оформление",
    Keyboard: "Клавиатура",
    Browser: "Браузер",
    Files: "Файлы",
    Projects: "Проекты",
    Machines: "Машины",
    Mobile: "Мобильные устройства",
    "Environment variables": "Переменные окружения",
    Updates: "Обновления",
    "Installed plugins": "Установленные плагины",
    "Plugin marketplaces": "Каталоги плагинов",
    Experiments: "Эксперименты",
    Community: "Сообщество",
    "Archived threads": "Архив диалогов",
    Archived: "Архив",
    Plugins: "Плагины",
    "This phone": "Этот телефон",
    "This device": "Это устройство",
    "Back to app": "Вернуться в приложение",
    Search: "Поиск",
    "Search settings": "Поиск настроек",
    "Clear settings search": "Очистить поиск настроек",
    "Settings search results": "Результаты поиска настроек",
    "No settings found": "Настройки не найдены",
    Language: "Язык",
    "Interface language": "Язык интерфейса",
    "Choose interface language": "Выбрать язык интерфейса",
    "System language": "Как в системе",
    "Use this device's preferred supported language.":
      "Использовать поддерживаемый язык этого устройства.",
    "Use English for the interface.": "Показывать интерфейс на английском.",
    "Use Russian for the interface.": "Показывать интерфейс на русском.",
    "Applies to connected clients without restarting. Code and filenames keep their original text.":
      "Применяется на подключённых устройствах без перезапуска. Код и имена файлов сохраняют исходный текст.",
    "AI response language": "Язык ответов ИИ",
    "Choose AI response language": "Выбрать язык ответов ИИ",
    "Follow interface language": "Как в интерфейсе",
    "Use the interface language. In System mode, keep the sending device's language for queued and background work.":
      "Использовать язык интерфейса. В режиме «Как в системе» сохранять язык устройства, с которого пришло задание, в том числе в очереди и фоновой работе.",
    "Prefer English for AI explanations.":
      "Предпочитать английский для объяснений ИИ.",
    "Prefer Russian for AI explanations.":
      "Предпочитать русский для объяснений ИИ.",
    "Applies to new requests, including queued messages when they start. An explicit language in your request takes precedence. Existing replies are unchanged.":
      "Применяется к новым запросам, в том числе к заданиям из очереди при запуске. Явно указанный в запросе язык имеет приоритет. Прежние ответы сохраняются.",
    "Russian translations cover settings navigation, selected settings, model switching and queue controls. Other text uses English while translation continues.":
      "Переведены навигация настроек, часть настроек, переключение моделей и управление очередью. Остальной текст остаётся на английском до завершения перевода.",
    "Threads & editing": "Диалоги и редактирование",
    "Navigate to threads on creation": "Открывать диалог после создания",
    "Default thread followup behavior": "Поведение Enter в активном диалоге",
    "What Enter does in the prompt box while the thread runs.":
      "Действие клавиши Enter в поле ввода во время работы агента.",
    "Thread archive confirmation": "Подтверждать архивацию диалога",
    "Show messages from before a context clear":
      "Показывать сообщения до очистки контекста",
    "Resume interrupted threads after a restart":
      "Продолжать прерванные диалоги после перезапуска",
    "Summarize shell commands": "Краткие описания команд терминала",
    "New branch prefix": "Префикс новых веток",
    "Setup guide": "Начальная настройка",
    "Replay setup guide": "Повторить начальную настройку",
    Links: "Ссылки",
    "Open links in the in-app browser":
      "Открывать ссылки во встроенном браузере",
    "Rewrite localhost links": "Переписывать ссылки localhost",
    Terminals: "Терминалы",
    "Copy on select": "Копировать при выделении",
    "Privacy & diagnostics": "Конфиденциальность и диагностика",
    "Streamer mode": "Режим трансляции",
    "Share anonymous usage data":
      "Отправлять анонимную статистику использования",
    "Show diagnostic events": "Показывать диагностические события",
    Theme: "Тема",
    Palette: "Палитра",
    "Favicon color": "Цвет значка вкладки",
    Navigation: "Навигация",
    "Sidebar thread list": "Список диалогов в боковой панели",
    "Sidebar footer": "Нижняя часть боковой панели",
    "Fade inactive splits": "Затемнять неактивные панели",
    "Source code": "Исходный код",
    Diffs: "Изменения",
    Light: "Светлая",
    Dark: "Тёмная",
    System: "Системная",
    Steer: "Уточнить задачу",
    Queue: "Добавить в очередь",
    Save: "Сохранить",
    Cancel: "Отмена",
    Reset: "Сбросить",
    Default: "По умолчанию",
    "Reset to default": "Вернуть значение по умолчанию",
    "Ask before archiving a thread with unarchived child threads.":
      "Запрашивать подтверждение, если у диалога есть неархивированные дочерние диалоги.",
    "Earlier messages stay in the thread for you to read. The agent doesn't see them.":
      "Ранние сообщения остаются в диалоге для чтения. Агент их не видит.",
    "Resume threads interrupted by an update, crash or restart, and tell the agent what was cut off. Queued messages send afterward.":
      "Продолжать диалоги, прерванные обновлением, сбоем или перезапуском, и сообщать агенту о прерывании. Затем отправляются сообщения из очереди.",
    "Show short summaries for commands that read, list, or search files. Turn off to show command text and let you expand each command to view its output.":
      "Показывать краткие описания команд чтения, просмотра и поиска файлов. При отключении отображается текст команды; её можно раскрыть и посмотреть вывод.",
    "Walk through connecting an agent, adding projects, plugins, and devices again.":
      "Ещё раз пройти подключение агента, добавление проектов, плагинов и устройств.",
    "Show setup guide": "Открыть начальную настройку",
    "Enter adds a follow-up. It runs when the agent stops. Command+Enter (Ctrl+Enter on Windows and Linux) steers the run.":
      "Enter добавляет запрос в очередь до остановки агента. Command+Enter (Ctrl+Enter в Windows и Linux) уточняет текущую задачу.",
    "Enter steers the run now. Command+Enter (Ctrl+Enter on Windows and Linux) adds a follow-up for later.":
      "Enter уточняет текущую задачу. Command+Enter (Ctrl+Enter в Windows и Linux) добавляет запрос в очередь.",
    "Open web links inside bb.": "Открывать веб-ссылки внутри bb.",
    "When enabled, localhost URLs are rewritten to use the same host or IP address you use to open BB. For example: {source} → {target}":
      "Заменять localhost в ссылках на адрес, по которому открыт BB. Например: {source} → {target}",
    "Automatically copy selected terminal text and show a notification. Does not affect text elsewhere in the app. Linux middle-click paste uses the primary selection independently.":
      "Автоматически копировать выделенный текст терминала и показывать уведомление. В остальном приложении выделение работает как обычно. Вставка средней кнопкой в Linux использует отдельный буфер выделения.",
    "Hide the custom models from config.json in every model picker, so a screen share does not show them.":
      "Скрывать пользовательские модели из config.json во всех списках моделей во время демонстрации экрана.",
    "Send anonymous usage data, such as app starts, setup progress and feature use, to help improve bb. Turning this off takes effect immediately for this server.":
      "Отправлять анонимные сведения о запусках, настройке и использовании функций для улучшения bb. Отключение сразу применяется на этом сервере.",
    "Show provider environment resolution and unhandled provider events for troubleshooting.":
      "Показывать определение окружения провайдера и необработанные события для диагностики.",
    "No prefix": "Без префикса",
    "This prefix cannot start a valid git branch name.":
      "Префикс должен образовывать допустимое имя ветки Git.",
    "bb puts this in front of every branch it creates for a worktree, such as {branch}. Leave it empty for no prefix.":
      "bb добавляет префикс к именам веток рабочих копий, например {branch}. Оставьте поле пустым, чтобы не использовать префикс.",
    "Palettes change bb's colors, including syntax colors in diffs and file previews. Choose a built-in palette or create one from a prompt.":
      "Палитры меняют цвета bb, включая подсветку кода в изменениях и просмотре файлов. Выберите встроенную палитру или создайте свою по описанию.",
    "Tint browser tabs to tell instances apart.":
      "Различайте экземпляры BB по цвету значка вкладки.",
    Interface: "Интерфейс",
    Create: "Создать",
    Red: "Красный",
    Orange: "Оранжевый",
    Yellow: "Жёлтый",
    Green: "Зелёный",
    Teal: "Бирюзовый",
    Blue: "Синий",
    Purple: "Фиолетовый",
    Pink: "Розовый",
    "Fade out splits that do not have focus.": "Затемнять неактивные панели.",
    "Sidebar navigation": "Навигация в боковой панели",
    "What draws New thread, Plugins, Skills, and plugin pages in the sidebar.":
      "Выберите оформление кнопки нового диалога, плагинов, навыков и страниц плагинов в боковой панели.",
    "Which plugin draws your threads in the sidebar.":
      "Плагин, который отображает список диалогов в боковой панели.",
    "Choose automatic activation, BB's viewer, or a specific plugin on this device.":
      "Автоматический выбор, встроенный просмотрщик BB или определённый плагин на этом устройстве.",
    "Syntax highlighting and gutters from the bb code theme.":
      "Подсветка синтаксиса и поля редактора из темы кода bb.",
    "Applies to file diffs in threads, the diff panel, and plugin views.":
      "Применяется к изменениям файлов в диалогах, панели изменений и плагинах.",
    "Unified and split diffs from the bb code theme.":
      "Объединённый и раздельный просмотр изменений из темы кода bb.",
    Composer: "Поле ввода",
    "The prompt box in threads, the New thread screen, and message editors.":
      "Поле запроса в диалогах, на экране нового диалога и при редактировании сообщений.",
    Automatic: "Автоматически",
    "built-in": "встроенный",
    "bb (built-in)": "bb (встроенный)",
    "Chooses {title} ({source}).": "Выбирает {title} ({source}).",
    "{title} (built-in)": "{title} (встроенный)",
    "From the {plugin} plugin.": "Из плагина {plugin}.",
    "{plugin} plugin. {description}": "Плагин {plugin}. {description}",
    "Drag to reorder.": "Перетащите, чтобы изменить порядок.",
    "Reorder {label}": "Изменить порядок: {label}",
    "Show {label} in footer": "Показывать внизу боковой панели: {label}",
    "Mobile apps": "Мобильные приложения",
    "Report a bug": "Сообщить об ошибке",
    "App links": "Ссылки приложений",
    "BB asks before opening links like linear:// in another app. Approvals stay on this device and aren't synced.":
      "BB запрашивает разрешение перед открытием ссылок вроде linear:// в другом приложении. Разрешения хранятся только на этом устройстве.",
    "No apps are always allowed.": "Постоянные разрешения не выданы.",
    "Always allowed": "Всегда разрешено",
    "Remove {scheme} approval": "Отозвать разрешение для {scheme}",
    "Couldn't remove app link approval":
      "Не удалось отозвать разрешение для ссылки приложения",
    "Try again.": "Повторите попытку.",
    "Loading…": "Загрузка…",
    "Command line": "Командная строка",
    "bb CLI skills": "Навыки для bb CLI",
    Skills: "Навыки",
    Install: "Установить",
    Remove: "Удалить",
    Installed: "Установлено",
    "Installing…": "Установка…",
    "Out of date": "Нужно обновление",
    "Not installed": "Не установлено",
    Disconnected: "Нет подключения",
    "Install bb CLI": "Установить bb CLI",
    "Remove bb CLI": "Удалить bb CLI",
    "Install bb CLI skills": "Установить навыки bb CLI",
    "Installed at {path}. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex.":
      "Установлено в {path}. Управлять bb можно из любого терминала и через внешних агентов, например Claude Code или Codex.",
    "Installed at {path}, but its folder is not on your PATH. Add the folder to your PATH to use bb outside bb.":
      "Установлено в {path}, но каталог отсутствует в PATH. Добавьте его в PATH, чтобы пользоваться bb за пределами приложения.",
    "Install the bb CLI for use outside bb. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex. Threads in bb already have it.":
      "Установите bb CLI для работы из любого терминала и через внешних агентов, например Claude Code или Codex. В диалогах bb команда уже доступна.",
    "Already installed for use outside bb at {path}, by npm.":
      "Уже установлено через npm в {path} для работы за пределами bb.",
    "The bb machine on this computer added a bb at {path} that can run an older bb. Install replaces it with this one.":
      "Агент машины добавил команду в {path}, которая может запускать старую версию bb. Установка заменит её текущей.",
    "Another bb at {path} comes first on your PATH. Remove it to install this one.":
      "В PATH раньше находится другая команда bb: {path}. Удалите её, чтобы установить текущую.",
    "Install them into ~/.agents/skills and ~/.claude/skills so agents outside bb can use the bb CLI.":
      "Установите навыки в ~/.agents/skills и ~/.claude/skills, чтобы внешние агенты могли работать с bb CLI.",
    "Connect a machine to install them into ~/.agents/skills and ~/.claude/skills.":
      "Подключите машину для установки в ~/.agents/skills и ~/.claude/skills.",
    "Installed on {count} machines": "Установлено на устройствах: {count}",
    "Installed on {installed} of {total} machines":
      "Установлено: {installed} из {total}",
    "Installed the bb CLI skills on {hosts}":
      "Навыки bb CLI установлены: {hosts}",
    "Choose the machines to install them onto. Each one gets the skills in ~/.agents/skills and ~/.claude/skills, replacing any copy already there.":
      "Выберите машины. Навыки будут установлены в ~/.agents/skills и ~/.claude/skills на каждой, заменяя существующие копии.",
    "The skills go in ~/.agents/skills and ~/.claude/skills on {host}, replacing any copy already there.":
      "Навыки будут установлены в ~/.agents/skills и ~/.claude/skills на машине {host}, заменяя существующие копии.",
    "the selected machine": "выбранная машина",
    "Voice Input": "Голосовой ввод",
    Microphone: "Микрофон",
    Unsupported: "Не поддерживается",
    "System default": "По умолчанию в системе",
    "This browser does not expose microphone devices.":
      "В этом браузере недоступен выбор микрофона.",
    "Loading microphones.": "Загрузка микрофонов.",
    "Loading microphones": "Загрузка микрофонов",
    "Load microphones": "Обновить список микрофонов",
    "Check microphone access": "Проверить доступ к микрофону",
    "to see available devices.": "для просмотра доступных устройств.",
    "Preferred microphone is disconnected. Using another input until it reconnects.":
      "Выбранный микрофон отключён. До его подключения используется другой вход.",
    "Used for prompt voice input.":
      "Используется для голосового ввода запросов.",
    "Voice preferences": "Настройки голосового ввода",
    "Close voice preferences": "Закрыть настройки голосового ввода",
    "Allow mic access in your settings.":
      "Разрешите доступ к микрофону в настройках браузера.",
    "Can't open this mic. Choose another.":
      "Не удалось подключить этот микрофон. Выберите другой.",
    "Live microphone preview": "Проверка сигнала микрофона",
    "Live preview": "Проверка сигнала",
    Unavailable: "Недоступно",
    Listening: "Прослушивание",
    "Connecting…": "Подключение…",
    "This browser can't use a mic.": "В этом браузере недоступен микрофон.",
    "Connecting to microphone…": "Подключение к микрофону…",
    "No audio detected. Try another mic.":
      "Сигнал не обнаружен. Попробуйте другой микрофон.",
    "Speak to check your microphone.":
      "Произнесите что-нибудь для проверки микрофона.",
    "Input device": "Устройство ввода",
    "Preferred microphone (unavailable)": "Выбранный микрофон (недоступен)",
    "Preferred microphone unavailable. Using another input until it returns.":
      "Выбранный микрофон недоступен. До его подключения используется другой вход.",
    "Microphone permission denied": "Доступ к микрофону запрещён",
    "No microphones found": "Микрофоны не найдены",
    "Microphone devices unavailable": "Микрофоны недоступны",
    Rail: "Панель значков",
    "Icons on the left edge": "Значки у левого края",
    "Top list": "Список сверху",
    "Labeled rows above the thread list":
      "Строки с названиями над списком диалогов",
    "Thread list": "Список диалогов",
    "Pinned threads, custom sections, projects, machines, and nested threads.":
      "Закреплённые диалоги, свои разделы, проекты, машины и вложенные диалоги.",
    "bb's composer: rich text, @-mentions, slash commands, voice and attachments.":
      "Поле ввода bb: форматирование текста, @-упоминания, команды через /, голос и вложения.",
  }),
);

export function translateInterfaceText(
  message: string,
  language: ResolvedInterfaceLanguage,
  values?: Readonly<Record<string, string | number>>,
): string {
  const translated =
    language === "ru" ? (russian.get(message) ?? message) : message;
  return values === undefined
    ? translated
    : translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : placeholder,
      );
}
