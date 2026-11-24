# Видимость субагентов: готовый Agent Traces

24 ноября 2026. Пользователь попросил видеть своих субагентов в IDE и прежде
разработки нового плагина изучить существующие решения.

## Выбор

Использован готовый MIT-плагин
[Agent Traces 1.0.0](https://github.com/charpeni/bb-plugins/tree/de00e14f21632bbedebd0f957ab2b1bb5f25e58d/plugins/agent-traces),
commit `de00e14f21632bbedebd0f957ab2b1bb5f25e58d`. Проверены manifest,
app/server, trace/store и skill: плагин читает записанные события BB,
распознаёт delegation и parentToolCallId, добавляет страницу Traces, вкладку
Trace и действие Trace this turn. Для этой задачи новый renderer не нужен.

Требования BB>=0.47 и SDK>=0.6.79 соответствуют нашей сборке BB0.50.1 и
SDK0.6.180. Установка выполнила штатную сборку compatible app bundle.
OTLP endpoint пуст, autoExport выключен; отправка внешнему collector не включена.

## Настоящая QA

Сначала плагин установлен только в собственный QA store server21716/daemon29716.
Проверены появление Traces и пустое состояние. Создан отдельный fixture-проект,
содержащий README.md, и один настоящий Codex gpt-6.1-sol ход с двумя нативными
помощниками: прочитать README и перечислить файлы. Никаких изменений кода,
новых BB child threads или сетевых задач этим помощникам не поручалось.

Ход завершился за 24.398s: completed, 4 tool calls, 2 subagents, 0 child threads,
0 errors. Эти данные подтвердил CLI `agent-traces show`; UI показал отдельные
полосы `/root/read_readme` и `/root/list_files`. Настоящим кликом раскрыта первая
строка, где виден `cat README.md`. Скриншоты просмотрены. Источник доказательств
локально: `.tmp/verify-agent-traces-20261124`.

## Установка в рабочую IDE

После QA тот же точный commit установлен штатным `bb plugin install` в уже
работающую пользовательскую IDE server22028. Её frozen checkout, сервер,
Electron и daemon не перезапускались; launchId сервера сохранился. Плагин
running/enabled, добавился пункт Traces.

В отдельном браузерном клиенте на настоящем server22028 открыта трасса текущего
пользовательского диалога. В ней видны реальные `/root/subscription_ui_tests`,
`/root/glm_subscription_research`, `/root/subscription_backend_tests`.
Показанные Subagents считают делегирования/повторные ходы помощников, поэтому
число строк не следует выдавать за число одновременно работающих уникальных
исполнителей. Внешний экспорт остался выключен.

## Как открыть

Traces → текущий диалог → нужный ход → стрелка у строки субагента. Внутри обычного
диалога также доступны вкладка Trace в правой панели и Trace this turn у сообщения.
CLI: `bb agent-traces turns <thread-id> --json` и
`bb agent-traces show <thread-id> --turn latest --json`. Плагин поставляет
собственные skill и agent tool; реализация CLI и RPC входит в тот же пакет.

## Что остаётся

Это наблюдение за записанной работой. Выбор провайдера/модели, запуск большего
числа работников, остановка и повтор остаются отдельным пунктом roadmap.
Новая панель не обещает отменить native provider cap. Интерфейс плагина пока
английский. Содержимое зависит от событий провайдера; Codex может записывать
короткие команды с длительностью 0ms. iOS Safari и другие провайдеры в этом
этапе не проверены. Отдельной копии стороннего кода в personal fork нет.

Собственный QA thread завершён и архивирован. Его server/daemon и оба наших
headless browser clients остановлены; QA data и fixture удалены после проверки
owner-маркера и освобождения портов. QA checkout чистый на personal main PR33.
Рабочая IDE server22028 осталась запущена, установленный Agent Traces сохранён.
