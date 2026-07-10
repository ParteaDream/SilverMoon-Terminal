#!/usr/bin/env python3
"""读取 ~/Downloads 下的 genshin JSON 文件并格式化展示"""
import json, sys, os

def load(uid, key):
    downloads = os.path.expanduser("~/Downloads")
    files = [f for f in os.listdir(downloads) if f.startswith(f"genshin_{uid}") and f.endswith(f"_{key}.json")]
    if not files: return None
    latest = sorted(files)[-1]
    with open(os.path.join(downloads, latest)) as f:
        return json.load(f)

uid = sys.argv[1] if len(sys.argv) > 1 else "198286947"

# ── Binding ──
b = load(uid, "binding")
if b and b.get("retcode") == 0:
    for g in b["data"].get("list", []):
        if str(g["game_uid"]) == uid:
            r = g
            print(f"玩家: {r['nickname']} | UID: {r['game_uid']} | {r['region_name']} | Lv{r['level']}")
            print(f"官方服: {'是' if r.get('is_official') else '否'}")

# ── Index ──
idx = load(uid, "index")
if idx and idx.get("retcode") == 0:
    d = idx["data"]; r = d["role"]; s = d["stats"]
    print(f"\n昵称: {r['nickname']} | 服务器: {r['region']} | 冒险等级 Lv{r['level']}")
    print(f"活跃 {s['active_day_number']}天 | 成就 {s['achievement_number']} | 角色 {s['avatar_number']}个")
    if s.get('spiral_abyss'): print(f"深渊: {s['spiral_abyss']}")
    print(f"宝箱: 普{s['common_chest_number']} 精{s['exquisite_chest_number']} 珍{s['precious_chest_number']} 华{s['luxurious_chest_number']} 奇{s['magic_chest_number']}")
    for w in d.get('world_explorations', []):
        offs = ' '.join([f"[{o['name']} Lv{o['level']}]" for o in w.get('offerings',[])])
        print(f"  {w['name']}: {w['exploration_percentage']/10:.1f}% 声望Lv{w['level']} {offs}".rstrip())
    print(f"\n角色 ({len(d.get('avatars',[]))}个):")
    ELEM = {'Anemo':'风','Pyro':'火','Cryo':'冰','Electro':'雷','Hydro':'水','Geo':'岩','Dendro':'草'}
    for a in sorted(d.get('avatars',[]), key=lambda x:(-x['rarity'],-x['level'])):
        e = ELEM.get(a.get('element',''), a.get('element',''))
        print(f"  ★{a['rarity']} Lv{a['level']:>2} {e} {a['name']} 命{a['actived_constellation_num']}")
elif idx and idx.get("retcode") == 5003:
    print("\n⚠️ 首页/角色列表/探索度: 需要米游社App隐私设置中开启「游戏数据详情」")

# ── DailyNote ──
dn = load(uid, "dailyNote")
if dn and dn.get("retcode") == 0:
    r = dn["data"]
    print(f"\n── 实时便笺 ──")
    print(f"  树脂: {r['current_resin']}/{r['max_resin']} | 委托: {r['finished_task_num']}/{r['total_task_num']}")
    print(f"  周本减半: {r['remain_resin_discount_num']}/{r['resin_discount_num_limit']}")
    print(f"  洞天宝钱: {r['current_home_coin']}/{r['max_home_coin']}")
elif dn and dn.get("retcode") == 5003:
    print("⚠️ 实时便笺: 需要开启隐私「实时便笺」")

# ── SpiralAbyss ──
sa = load(uid, "spiralAbyss")
if sa and sa.get("retcode") == 0:
    a = sa["data"]
    print(f"\n── 深境螺旋 ──")
    print(f"  第{a.get('schedule_id','?')}期 | 最深: {a.get('max_floor','?')} | ★{a.get('total_star','?')}")
    for f in a.get('floors', []):
        if f.get('is_unlock'):
            print(f"  {f['index']}层 ★{f['star']}/{f['max_star']}")
elif sa and sa.get("retcode", 0) != 0:
    print(f"⚠️ 深境螺旋: retcode={sa.get('retcode')}")

# ── Characters ──
ch = load(uid, "characters")
if ch and ch.get("retcode") == 0:
    avatars = ch["data"].get("avatars", [])
    print(f"\n── 角色详情 ({len(avatars)}个) ──")
    ELEM = {'Anemo':'风','Pyro':'火','Cryo':'冰','Electro':'雷','Hydro':'水','Geo':'岩','Dendro':'草'}
    for a in sorted(avatars, key=lambda x:(-x['rarity'],-x['level']))[:10]:
        e = ELEM.get(a.get('element',''), a.get('element',''))
        w = a.get('weapon',{})
        print(f"  ★{a['rarity']} Lv{a['level']:>2} {e} {a['name']} | {w.get('name','?')} Lv{w.get('level','?')} 命{a['actived_constellation_num']}")
        if len(avatars) > 10: print(f"  ... 还有 {len(avatars)-10} 个角色")
elif ch and ch.get("retcode", 0) != 0:
    print(f"⚠️ 角色详情: 需要开启隐私「角色详情」")

print()
