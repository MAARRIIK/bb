# Отдельные worktree работников Workflows

24 ноября 2026. Основа personal main после PR34 (`c5a4efa`), ветка
`feat/workflow-worker-worktrees`. Рабочая IDE пользователя server22028 и её
frozen checkout PR29 не обновлялись и не перезапускались; Agent Traces сохранён.

## Изменение и причина

Проверены готовые Tasks, Workflows, Concurrency limit и git-worktree provider.
Tasks уже выбирает модели через presets и умеет worktree, но не предоставляет
устойчивую очередь dispatch с восстановлением. Workflows уже имеет SQLite,
семафор, ограничения, retries, stop/resume и результаты, но все его работники
использовали origin environment. Расширен существующий Workflows без нового
исполнителя и второго планировщика.

`agent(prompt, {workspace: {type: "worktree", baseBranch: "main"}})` создаёт
отдельную worktree на той же машине, что origin. `{type: "shared"}` и отсутствие
поля сохраняют прежнее поведение. Папки создаёт штатный SDK/core git-worktree.
Из-за автоматического архивирования workflow workers обычная временная папка
была бы удалена core после grace period. Поэтому новая папка создаётся с
`hold: "user"` и хранится до явного удаления пользователем, при любом исходе.
Имя включает run name, номер worker и call id. Повторная попытка создаёт новую
папку и сохраняет прежнюю; это требует диска и ручной очистки. Отмена во время
HTTP create может оставить held environment без worker: у SDK create нет
AbortSignal. Нового работника после отмены этот путь не запускает.

В папку попадает явная базовая ветка, без незакоммиченных правок origin.
Автоматического слияния нет. CLI, agent tool и SDK используют тот же скриптовый
контракт; UI/RPC view показывает режим возле каждой модели и поясняет сохранение
папок. Внутренние options всегда содержат workspace; старые сохранённые JSON
получают shared на границе. Старый shared cache digest сохранён, worktree mode
и baseBranch входят в identity. Cached replay возвращает результат без новой
папки. Новых SDK exports, daemon wire fields или миграций базы нет; protocol284
не меняется, workspace хранится в существующем optionsJson.

## Проверки

`pnpm exec turbo run test typecheck lint --filter=bb-plugin-workflows`:
**304 теста, 14 файлов, 10 задач успешно**. Реальный plugin entry + SQLite
проверяют раздельные user-held environments, старый shared режим, invalid
workspace, отсутствие fallback, отмену, ошибки создания, cache при смене режима
и ветки. UI проверяет разные workspace возле разных моделей и переход к worker.

Живая QA использовала отдельный checkout, свежий owner-marked store,
server21716/daemon29716, Node22.19.0, disposable Git project с main и README.
Использованы реальные доступные модели Codex gpt-6.1-sol/gpt-6.1-terra, reasoning
low, full permissions. Перед запуском проверен настоящий catalog; host limit11,
workflow concurrency8. Лимиты пользовательской IDE не менялись.

Первый прогон выявил гонку: SDK create возвращает statuscreating до готовности
папки, немедленный reuse получал HTTP409 environment_not_ready. В parallel
исходная ошибка ещё и терялась за Parent workflow finished. Исправлены ожидание
creating/provisioning с abort-aware polling и сохранение окончательной startup
ошибки в failed call. Неудачные прогоны сохранены в доказательствах и не выданы
за успешную генерацию.

Повторный workflow реально запустил **четырёх одновременно active BB workers**
на двух моделях. Bounded SDK samples зафиксировали максимум4. Все четыре
completed/succeeded; каждый создал только свой marker-wN.txt с ожидаемым wN
в своей cwd. SDK и файловое чтение подтвердили четыре environment id/пути,
тот же host, heldByuser, statusready; в origin маркеров нет. Все четыре worker
архивированы штатным Workflows, папки и файлы остались. После собственного
QA restart proof повторился, retireAtnull. Resume того же source дал четыре
cached результата, число environments не увеличилось.

Настоящие UI клики открыли workflow panel, строки четырёх моделей/worktree и
завершённый Terra worker. Просмотрены desktop и mobile390×844 скриншоты. На
мобильной узкой панели длинные metadata сокращаются; это не проверка iOS Safari.
Настоящий запуск с несуществующей базовой веткой завершился failed с точной
ошибкой Git, childThreadIdnull, без fallback или правок origin.

В остановленной собственной QA-копии удаление ожидания готовности заставило
новый regression test упасть. Отдельное удаление сохранения startup error дало
два ожидаемых провала: вместо failed/реальной ошибки появлялись cancelled и
Parent workflow finished. После побайтового восстановления production все три
выбранных теста прошли. Root source при этих проверках не менялся.

Локальные доказательства: `.tmp/verify-workflow-worktrees-20261124`.

## Границы

Визуальный конструктор команды и индивидуальное stop/retry не добавлены: это
следующий шаг roadmap. Есть существующий stop/resume всего workflow и выбор
моделей в script. Новые ветки не получают незакоммиченные правки origin и не
сливаются автоматически. Другие провайдеры и новые тарифы этой QA не проверены.
Четыре BB workers не означают изменение native collaboration cap Codex.

Общий inventory helper снова остановился на baseline `Unmapped CLI family:
diagnostics`; его ownership не менялся, соответствующий workflow recipe обновлён.
Пустые удалённые GitHub checks не считаются зелёным CI.

Собственный origin архивирован, все 11 QA environments (включая неудачные
прогоны) явно удалены через обычный `bb environment delete`; итоговый list пуст.
QA server/daemon и наш браузер остановлены. Store и fixture удалены только
после проверки owner-маркера и свободных портов. Снимки/логи сохранены отдельно.
