/* ==========================================================
   FRUIT BLITZ — ПЕРЕВОДЫ (i18n)
   Как добавить новый язык: скопируйте блок ru, переведите значения, добавьте
   код в LOCALES. Как перевести новый текст в игре: добавьте ключ сюда, замените
   в game.js/market.js литеральную строку на t('ключ').
   Всё, чего нет в текущей локали, автоматически берётся из ru (запасной вариант) —
   ничего не сломается и не покажет "undefined", просто останется по-русски.
   ========================================================== */
(function (root) {
  const LOCALES = ['ru', 'en'];

  const ru = {
    // Общее
    play: 'Играть', close: 'Закрыть', cancel: 'Отмена', continue_: 'Продолжить', back: 'Назад',
    yes: 'Да', no: 'Нет', buy: 'Купить', claim: 'Забрать', open: 'Открыть', wait: 'Подождать',
    level_word: 'Уровень', coins: 'Монеты', gems: 'Кристаллы', lives: 'Жизни', star: 'Звезда',
    // Нижняя навигация
    nav_shop: 'Магазин', nav_garden: 'Сад', nav_home: 'Главная', nav_quests: 'Задания', nav_market: 'Маркет', nav_arena: 'Арена', nav_leaders: 'Рейтинг',
    // Главный экран
    home_play: '▶ ИГРАТЬ', home_map: 'Карта', home_map_sub: 'Все уровни', home_wheel: 'Колесо', home_daily: 'Бонус дня',
    home_gift: 'Подарок', home_collection: 'Коллекция', home_collection_sub: 'Предметы', home_leaders_sub: 'Топ игроков',
    // Настройки
    settings_title: 'Настройки', settings_sound: 'Звуки', settings_vibro: 'Вибрация', settings_notify: 'Напоминания в Telegram',
    settings_share: 'Поделиться прогрессом', settings_channel: 'Канал с новостями', settings_tutorial: 'Пройти обучение заново',
    settings_invite: 'Пригласить друга', settings_lang: 'Язык / Language',
    // Пауза
    pause_title: 'Пауза', pause_resume: 'Продолжить', pause_restart: '↻ Начать заново', pause_quit: 'Выйти из уровня',
    // Уровень пройден / не пройден
    result_title: 'Уровень пройден!', result_next: 'Дальше', result_replay: '↺ Ещё раз', result_moves: 'Ходов', result_score: 'Очки',
    oom_title: 'Ходы закончились!', oom_ad: '📺 Смотреть рекламу — +5 ходов', oom_gems: 'Купить 5 ходов', oom_quit: 'Выйти',
    nolives_title: 'Жизни закончились', nolives_wait: 'Следующая жизнь через', nolives_ad: '📺 Смотреть рекламу — +1 ❤️',
    // Магазин
    shop_title: 'Магазин', shop_donate: 'Донат', shop_hits: 'Хиты', shop_boosters: 'Бустеры', shop_lives: 'Жизни',
    shop_chests: 'Сундуки', shop_skins: 'Скины', shop_profile: 'Профиль', shop_currency: 'Обмен',
    // Сад
    garden_title: 'Волшебный Сад', garden_build: 'Построить',
    // Задания
    quests_title: 'Задания', quests_daily: 'Ежедневные', quests_login: 'Вход 7 дней', quests_ach: 'Достижения',
    // Арена
    arena_title: 'Арена', arena_daily: '🔥 Испытание дня', arena_duels: '⚔️ Дуэли', arena_challenge: '⚔️ Вызвать друга',
    // Рейтинг
    leaders_title: '🏆 Рейтинг',
    // Тосты/общие сообщения
    toast_not_enough_coins: 'Не хватает монет', toast_not_enough_gems: 'Не хватает кристаллов', toast_telegram_only: 'Доступно внутри Telegram',
  };

  // Английский — только то, что реально видит новый игрок в первые минуты (ядро). Остального
  // намеренно пока нет: автоматически подставится русский текст (см. get() ниже).
  const en = {
    play: 'Play', close: 'Close', cancel: 'Cancel', continue_: 'Continue', back: 'Back',
    yes: 'Yes', no: 'No', buy: 'Buy', claim: 'Claim', open: 'Open', wait: 'Wait',
    level_word: 'Level', coins: 'Coins', gems: 'Gems', lives: 'Lives', star: 'Star',
    nav_shop: 'Shop', nav_garden: 'Garden', nav_home: 'Home', nav_quests: 'Quests', nav_market: 'Market', nav_arena: 'Arena', nav_leaders: 'Leaders',
    home_play: '▶ PLAY', home_map: 'Map', home_map_sub: 'All levels', home_wheel: 'Wheel', home_daily: 'Daily bonus',
    home_gift: 'Gift', home_collection: 'Collection', home_collection_sub: 'Items', home_leaders_sub: 'Top players',
    settings_title: 'Settings', settings_sound: 'Sound', settings_vibro: 'Vibration', settings_notify: 'Telegram reminders',
    settings_share: 'Share progress', settings_channel: 'News channel', settings_tutorial: 'Replay tutorial',
    settings_invite: 'Invite a friend', settings_lang: 'Язык / Language',
    pause_title: 'Paused', pause_resume: 'Resume', pause_restart: '↻ Restart', pause_quit: 'Quit level',
    result_title: 'Level complete!', result_next: 'Next', result_replay: '↺ Replay', result_moves: 'Moves', result_score: 'Score',
    oom_title: 'Out of moves!', oom_ad: '📺 Watch ad — +5 moves', oom_gems: 'Buy 5 moves', oom_quit: 'Quit',
    nolives_title: 'Out of lives', nolives_wait: 'Next life in', nolives_ad: '📺 Watch ad — +1 ❤️',
    shop_title: 'Shop', shop_donate: 'Donate', shop_hits: 'Hits', shop_boosters: 'Boosters', shop_lives: 'Lives',
    shop_chests: 'Chests', shop_skins: 'Skins', shop_profile: 'Profile', shop_currency: 'Exchange',
    garden_title: 'Magic Garden', garden_build: 'Build',
    quests_title: 'Quests', quests_daily: 'Daily', quests_login: '7-Day Login', quests_ach: 'Achievements',
    arena_title: 'Arena', arena_daily: '🔥 Daily Challenge', arena_duels: '⚔️ Duels', arena_challenge: '⚔️ Challenge a friend',
    leaders_title: '🏆 Leaderboard',
    toast_not_enough_coins: 'Not enough coins', toast_not_enough_gems: 'Not enough gems', toast_telegram_only: 'Available inside Telegram',
  };

  const DICTS = { ru, en };
  const STORE_KEY = 'fb_lang';
  function detect() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved && LOCALES.includes(saved)) return saved;
    } catch (e) { /* noop */ }
    try {
      const tgLang = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user && window.Telegram.WebApp.initDataUnsafe.user.language_code;
      if (tgLang && LOCALES.includes(tgLang)) return tgLang;
    } catch (e) { /* noop */ }
    return 'ru';
  }
  let current = detect();
  function setLocale(loc) {
    if (!LOCALES.includes(loc)) return;
    current = loc;
    try { localStorage.setItem(STORE_KEY, loc); } catch (e) { /* noop */ }
  }
  function t(key, vars) {
    let s = (DICTS[current] && DICTS[current][key]) || ru[key] || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  }
  root.I18N = { t, setLocale, getLocale: () => current, LOCALES, names: { ru: 'Русский', en: 'English' } };
})(window);
