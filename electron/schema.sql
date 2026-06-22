-- ============================================================================
-- 银月终端数据库 Schema
-- 自动生成，与项目数据库完全匹配
-- ============================================================================

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,
  name_en TEXT,
  max_rarity INTEGER NOT NULL DEFAULT 5, -- 最高稀有度
  description_zh TEXT,
  flower_description_zh TEXT,         -- 生之花描述
  plume_description_zh TEXT,          -- 死之羽描述
  sands_description_zh TEXT,          -- 时之沙描述
  goblet_description_zh TEXT,         -- 空之杯描述
  circlet_description_zh TEXT,        -- 理之冠描述
  flower_name_zh TEXT,                -- 生之花
  plume_name_zh TEXT,                 -- 死之羽
  sands_name_zh TEXT,                 -- 时之沙
  goblet_name_zh TEXT,                -- 空之杯
  circlet_name_zh TEXT,               -- 理之冠
  two_piece_bonus TEXT,               -- 2件套效果
  four_piece_bonus TEXT,              -- 4件套效果
  story_zh TEXT,                      -- 背景故事
  flower_story_zh TEXT,               -- 生之花故事
  plume_story_zh TEXT,                -- 死之羽故事
  sands_story_zh TEXT,                -- 时之沙故事
  goblet_story_zh TEXT,               -- 空之杯故事
  circlet_story_zh TEXT,              -- 理之冠故事
  image TEXT,                         -- 圣遗物套装图片（生之花）
  plume_image TEXT,                   -- 死之羽图片
  sands_image TEXT,                   -- 时之沙图片
  goblet_image TEXT,                  -- 空之杯图片
  circlet_image TEXT,                 -- 理之冠图片
  sort_order INTEGER DEFAULT 0
, flower_image TEXT);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  type TEXT NOT NULL,                 -- 'spiral_abyss' / 'imaginarium_theater' / 'perilous_trail'
  name_zh TEXT,
  start_date TEXT,
  end_date TEXT,
  description_zh TEXT,
  upper_buff TEXT,                    -- 深境螺旋上半Buff
  lower_buff TEXT,                    -- 深境螺旋下半Buff
  moon_blessing TEXT,                 -- 深境螺旋渊月祝福
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_ascension_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE ON UPDATE CASCADE,
  quantity TEXT, element_id INTEGER,                      -- JSON: {ascension_level: quantity}
  UNIQUE(character_id, material_id)
);

CREATE TABLE IF NOT EXISTS character_constellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,             -- 1-6
  name_zh TEXT NOT NULL,
  description_zh TEXT,
  icon TEXT,
  element_id INTEGER
);

CREATE TABLE IF NOT EXISTS character_outfits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name_zh TEXT NOT NULL,
  description_zh TEXT,
  image TEXT,                         -- 时装图片文件名
  avatar_image TEXT,                  -- 时装头像文件名（用于替换角色默认头像）
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title_zh TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_talent_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE ON UPDATE CASCADE,
  material_type TEXT,                 -- 'book', 'boss_drop', 'common', 'weekly_boss'
  quantities TEXT, element_id INTEGER,                    -- JSON: {level_range: quantity}
  UNIQUE(character_id, material_id, material_type)
);

CREATE TABLE IF NOT EXISTS character_talents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'active', -- active(技能) / passive(固有天赋)
  name_zh TEXT NOT NULL,
  description_zh TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  skill_table TEXT,
  element_id INTEGER
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  name_zh TEXT NOT NULL UNIQUE,       -- 中文名
  name_en TEXT,                       -- 英文名 (如 Hu Tao)
  title_zh TEXT,                      -- 称号 (如「雪霁梅香」)
  rarity INTEGER NOT NULL DEFAULT 5,  -- 稀有度 (4/5)
  element_id INTEGER REFERENCES elements(id),
  weapon_type_id INTEGER REFERENCES weapon_types(id),
  region_id INTEGER REFERENCES regions(id),
  birthday TEXT,                      -- 生日 MM-DD
  affiliation TEXT,                   -- 所属 (如 往生堂)
  release_date TEXT,                  -- 上线日期 YYYY-MM-DD (如 2020-09-28)
  constellation_zh TEXT,              -- 命之座名称 (如 引蝶座)
  description_zh TEXT,                -- 角色简介
  story TEXT,                         -- 背景故事
  splash_art TEXT,                    -- 立绘文件名
  card_art TEXT,                      -- 头像文件名
  namecard_art TEXT,                  -- 名片文件名
  dish_name TEXT,                     -- 特殊料理名称
  dish_description TEXT,              -- 特殊料理描述
  dish_effect TEXT,                   -- 特殊料理效果
  dish_image TEXT,                    -- 特殊料理图片文件名
  -- 属性（由迁移自动添加，此处为文档说明）
  hp_80 INTEGER, hp_90 INTEGER, hp_95 INTEGER, hp_100 INTEGER,
  atk_80 INTEGER, atk_90 INTEGER, atk_95 INTEGER, atk_100 INTEGER,
  def_80 INTEGER, def_90 INTEGER, def_95 INTEGER, def_100 INTEGER,
  ascension_stat TEXT,                -- 突破属性名称（如 "暴击率"）
  ascension_stat_value REAL,          -- 突破属性数值
  ascension_stats TEXT,               -- 突破属性完整文本（如 "+19.2%"）
  character_type TEXT DEFAULT 'normal', -- 角色类型（normal / traveler）
  gallery_images TEXT,                -- 图库自定义图片 JSON: [{label, filename}]
  namecard_name TEXT,                 -- 名片名称
  namecard_description TEXT,          -- 名片简介（富文本标记）
  active_outfit_id INTEGER            -- 当前活动的时装 ID（用于切换头像显示）
);

CREATE TABLE IF NOT EXISTS element_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  elements TEXT NOT NULL,             -- JSON: [element_id, element_id]
  type TEXT,                          -- transformative / amplifying / other
  base_damage_formula TEXT,
  description_zh TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,       -- 中文名 (火、水、风、雷、草、冰、岩)
  name_en TEXT NOT NULL UNIQUE,       -- 英文名 (Pyro, Hydro, Anemo, Electro, Dendro, Cryo, Geo)
  color TEXT NOT NULL,                -- 颜色 hex
  icon TEXT                           -- 元素图标文件名
);

CREATE TABLE IF NOT EXISTS enemies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,
  name_en TEXT,
  type TEXT,                          -- 普通/精英/Boss/周本Boss
  description_zh TEXT,
  image TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- 'damage_formula' / 'reaction' / 'stat' / 'gacha' / 'resin' / 'other'
  title_zh TEXT NOT NULL,
  content TEXT NOT NULL,              -- Markdown 格式的内容
  tags TEXT,                          -- JSON: [tag1, tag2]
  images TEXT,                        -- JSON: ["filename1.png", "filename2.jpg"]
  tables TEXT,                        -- JSON: [{ title, headers: [], rows: [[]] }]
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS websites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_zh TEXT NOT NULL,
  url TEXT NOT NULL,
  description_zh TEXT,
  icon TEXT,
  image TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS imaginarium_theater_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  recommended_elements TEXT,          -- JSON: [element_id, ...] (推荐元素, max 3)
  opening_characters TEXT,            -- JSON: [character_id, ...] (开幕角色, max 6)
  special_guests TEXT,                -- JSON: [character_id, ...] (特邀角色, max 4)
  enemy_config TEXT,                  -- JSON: {"round3":["enemy"],"round6":[],"round8":[],"round10":[],"card1":[],"card2":[]}
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,
  name_en TEXT,
  type TEXT NOT NULL,                 -- character_ascension, weapon_ascension, talent, cooking, local_specialty, common, boss_drop, weekly_boss_drop, event
  rarity INTEGER DEFAULT 1,
  description_zh TEXT,
  source TEXT,                        -- 获取来源
  usage TEXT,                         -- 用途
  image TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS perilous_trail_bosses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      difficulty TEXT NOT NULL,
      boss_index INTEGER NOT NULL,
      boss_name TEXT,
      boss_image TEXT,
      boss_level INTEGER,
      boss_hp TEXT,
      advantages TEXT,
      disadvantages TEXT,
      details TEXT,
      sort_order INTEGER DEFAULT 0
    , hidden_info TEXT);

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL UNIQUE,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS spiral_abyss_floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      chamber_number INTEGER NOT NULL,
      half INTEGER NOT NULL DEFAULT 1,
      enemies_data TEXT,
      sort_order INTEGER DEFAULT 0
    );

CREATE TABLE IF NOT EXISTS talent_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  talent_id INTEGER NOT NULL REFERENCES character_talents(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,             -- 1-15
  params TEXT                         -- JSON: [param1, param2, ...] 倍率参数
);

CREATE TABLE IF NOT EXISTS weapon_ascension_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weapon_id INTEGER NOT NULL REFERENCES weapons(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE ON UPDATE CASCADE,
  quantity TEXT,
  UNIQUE(weapon_id, material_id)
);

CREATE TABLE IF NOT EXISTS weapon_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,       -- 单手剑、双手剑、长柄武器、弓、法器
  name_en TEXT NOT NULL UNIQUE,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS weapons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL UNIQUE,
  name_en TEXT,
  rarity INTEGER NOT NULL DEFAULT 4,  -- 1-5
  weapon_type_id INTEGER REFERENCES weapon_types(id),
  base_atk INTEGER NOT NULL,          -- 基础攻击力 (Lv1)
  max_base_atk INTEGER,               -- 基础攻击力 (Lv90)
  secondary_stat TEXT,                -- 副属性名称 (如 暴击伤害)
  secondary_stat_value REAL,          -- 副属性值 (Lv1)
  max_secondary_stat_value REAL,      -- 副属性值 (Lv90)
  passive_name_zh TEXT,               -- 被动/特效名
  passive_description_zh TEXT,        -- 被动描述
  refinement TEXT,                    -- 精炼等级描述 JSON
  story_zh TEXT,                      -- 背景故事
  description_zh TEXT,                -- 简介
  image TEXT,                         -- 武器图片文件名
  simple_art TEXT,                    -- 装备图文件名（用于头像）
  gallery_images TEXT,                -- JSON: [{label, filename}] 图库
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wish_banner_items (id INTEGER PRIMARY KEY AUTOINCREMENT, banner_id INTEGER NOT NULL REFERENCES wish_banners(id) ON DELETE CASCADE, item_type TEXT NOT NULL, item_id INTEGER NOT NULL, rarity INTEGER NOT NULL DEFAULT 5, sort_order INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS wish_banners (id INTEGER PRIMARY KEY AUTOINCREMENT, wish_id INTEGER NOT NULL REFERENCES wishes(id) ON DELETE CASCADE, name_zh TEXT, banner_image TEXT, sort_order INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS wish_rate_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,            -- 'character' or 'weapon'
  item_id INTEGER NOT NULL,           -- references characters.id or weapons.id
  is_featured INTEGER DEFAULT 1,      -- 5★ featured
  rarity_boost INTEGER DEFAULT 0,     -- for 4★ rate-up
  UNIQUE(wish_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,              -- 版本号 (如 5.0)
  phase INTEGER NOT NULL DEFAULT 1,   -- 阶段 (1/2)
  banner_type TEXT NOT NULL,          -- character-event / weapon-event / standard / beginner
  name_zh TEXT,
  banner_image TEXT,
  start_date TEXT,
  end_date TEXT,
  description_zh TEXT
);

