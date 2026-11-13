import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const W = 480;
const H = 560;
const ASSET = "/duel";

type RankVisual = "locked" | "offline" | "active";
type PageId =
  | "home"
  | "profile"
  | "history"
  | "season"
  | "honor"
  | "mail"
  | "settings"
  | "cards"
  | "leaderboard"
  | "tasks"
  | "activate";

type Player = {
  nickname: string;
  level: number;
  xp: number;
  xpNext: number;
  historicalCups: number;
  uid: string;
  seasonCups: number;
  seasonRank: number | null;
  tier: string;
  honorPower: number;
  nationRank: number | null;
  provinceRank: number | null;
  province: string;
  title: string | null;
  premium: boolean;
  online: boolean;
  verified: boolean;
  unread: number;
};

const DEMO: Player = {
  nickname: "星海旅人",
  level: 18,
  xp: 640,
  xpNext: 1000,
  historicalCups: 245,
  uid: "A1B2C3D4",
  seasonCups: 860,
  seasonRank: 12,
  tier: "钻石",
  honorPower: 480,
  nationRank: 3,
  provinceRank: 1,
  province: "广东",
  title: null,
  premium: false,
  online: true,
  verified: false,
  unread: 1,
};

function rankVisual(player: Player): RankVisual {
  if (!player.premium || !player.verified) return "locked";
  if (!player.online) return "offline";
  return "active";
}

function img(path: string) {
  return `${ASSET}/${path}`;
}

export function DuelView() {
  const [player, setPlayer] = useState<Player>(DEMO);
  const [page, setPage] = useState<PageId>("home");
  const [stack, setStack] = useState<PageId[]>([]);
  const [toast, setToast] = useState("");
  const [board, setBoard] = useState<"season" | "honor">("season");
  const [region, setRegion] = useState<"nation" | "province">("nation");
  const [pressed, setPressed] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const visual = rankVisual(player);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const fit = () => {
      const box = node.parentElement;
      if (!box) return;
      const next = Math.min(box.clientWidth / W, (box.clientHeight || H) / H);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, []);

  function open(next: PageId) {
    setStack((current) => [...current, page]);
    setPage(next);
    setToast("");
  }

  function back() {
    setStack((current) => {
      const copy = [...current];
      const previous = copy.pop();
      setPage(previous ?? "home");
      return copy;
    });
    setToast("");
  }

  function show(message: string) {
    setToast(message);
  }

  function onRank() {
    if (visual === "locked") {
      open("activate");
      return;
    }
    if (visual === "offline") {
      show("请联网后再进行排位。正式排位不会启动，也不会记入战绩。");
      return;
    }
    show("已向服务器发起挑战核验。核验接口未接通，不会进入局内，也不会写入奖杯或战力。");
  }

  const preset = useMemo(
    () => [
      { id: "locked", label: "未激活", patch: { premium: false, verified: false, online: true, title: null } },
      { id: "active", label: "已激活", patch: { premium: true, verified: true, online: true, title: null } },
      { id: "offline", label: "离线", patch: { premium: true, verified: true, online: false, title: null } },
      { id: "title", label: "称号", patch: { premium: true, verified: true, online: true, title: "本周·全国冠军" } },
    ],
    [],
  );

  return (
    <main className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-[#06172d] text-[#f4f9ff]">
      <header className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <div>
          <p className="font-semibold tracking-tight">腕上对决 2.0</p>
          <p className="text-xs text-[#a4c1d8]">首页与个人主页 · 演示数据，不是线上实时</p>
        </div>
        <Link to="/" className="rounded-full border border-[#41769e] px-3 py-2 text-xs text-[#a4c1d8]">
          返回工坊
        </Link>
      </header>
      <div className="grid min-h-0 place-items-center px-3">
        <div ref={stageRef} style={{ width: W * scale, height: H * scale }}>
          <div
            className="relative overflow-hidden bg-[#06172d]"
            style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", borderRadius: 28 }}
          >
            <ScreenImage src={img("background/bg_night_pixel_480x560.png")} style={{ left: 0, top: 0, width: W, height: H }} />
            {page === "home" ? (
              <Home
                player={player}
                visual={visual}
                pressed={pressed}
                setPressed={setPressed}
                onOpen={open}
                onFree={() => show("进入当前自由 AI。局内画面和战斗引擎这次不改。")}
                onRank={onRank}
              />
            ) : (
              <Subpage page={page} player={player} board={board} region={region} onBack={back} onOpen={open} setBoard={setBoard} setRegion={setRegion} setPlayer={setPlayer} show={show} />
            )}
            {toast ? (
              <div className="absolute inset-0 grid place-items-center bg-[#03152b]/70 px-8" onClick={() => setToast("")}>
                <div className="w-full rounded-2xl border border-[#41769e] bg-[#0a2744] px-5 py-5 text-center" onClick={(event) => event.stopPropagation()}>
                  <p className="text-base leading-7">{toast}</p>
                  <button type="button" className="mt-4 min-h-11 rounded-full bg-[#108cf6] px-5 text-sm font-semibold" onClick={() => setToast("")}>
                    知道了
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 px-4 py-4">
        {preset.map((item) => (
          <button
            key={item.id}
            type="button"
            className="min-h-11 rounded-full border border-[#41769e] px-4 text-sm"
            onClick={() => {
              setPlayer({ ...DEMO, ...item.patch });
              setPage("home");
              setStack([]);
              setToast("");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </main>
  );
}

function Home({
  player,
  visual,
  pressed,
  setPressed,
  onOpen,
  onFree,
  onRank,
}: {
  player: Player;
  visual: RankVisual;
  pressed: string;
  setPressed: (id: string) => void;
  onOpen: (page: PageId) => void;
  onFree: () => void;
  onRank: () => void;
}) {
  const rankAsset = visual === "active" ? "button/main_gold_210x70.png" : visual === "offline" ? "button/main_offline_210x70.png" : "button/main_locked_210x70.png";
  const rankIcon = visual === "active" ? "icons/trophy_64.png" : visual === "offline" ? "icons/offline_64.png" : "icons/lock_64.png";
  const xp = Math.max(0, Math.min(1, player.xp / player.xpNext));
  return (
    <>
      <ScreenImage src={img("scene/castle_pixel_440x240.png")} style={{ left: 20, top: 124, width: 440, height: 240 }} />
      <ScreenImage src={img("logo/title_408x99.png")} style={{ left: 36, top: 226, width: 408, height: 99 }} />
      <ScreenImage src={img("panel/top_profile_442x76.png")} style={{ left: 19, top: 13, width: 442, height: 76 }} />
      <button type="button" aria-label="个人主页" className="absolute" style={{ left: 27, top: 19, width: 64, height: 64 }} onClick={() => onOpen("profile")}>
        <ScreenImage src={img("avatar/avatar_crowned_64.png")} style={{ left: 0, top: 0, width: 64, height: 64 }} />
      </button>
      <button type="button" className="absolute text-left" style={{ left: 100, top: 20, width: 180, height: 64 }} onClick={() => onOpen("profile")}>
        <p className="truncate text-[22px] font-semibold leading-none">{player.nickname}</p>
        <p className="mt-1 text-[15px] text-[#a4c1d8]">Lv.{player.level}</p>
        <div className="relative mt-1 h-[15px] w-[140px]">
          <ScreenImage src={img("panel/exp_track_140x15.png")} style={{ left: 0, top: 0, width: 140, height: 15 }} />
          <div className="absolute overflow-hidden" style={{ left: 0, top: 0, width: 140 * xp, height: 15 }}>
            <ScreenImage src={img("panel/exp_fill_140x15.png")} style={{ left: 0, top: 0, width: 140, height: 15 }} />
          </div>
        </div>
      </button>
      {player.title ? (
        <p className="pointer-events-none absolute rounded-full bg-[#ffc63b] px-2 py-0.5 text-[12px] font-semibold text-[#03152b]" style={{ left: 100, top: 78 }}>
          {player.title}
        </p>
      ) : null}
      <button type="button" className="absolute" style={{ left: 292, top: 27, width: 166, height: 48 }} onClick={() => onOpen("history")}>
        <ScreenImage src={img("panel/history_pill_166x48.png")} style={{ left: 0, top: 0, width: 166, height: 48 }} />
        <ScreenImage src={img("icons/trophy_64.png")} style={{ left: 14, top: 8, width: 32, height: 32 }} />
        <span className="absolute text-[22px] font-semibold" style={{ right: 18, top: 8 }}>{player.historicalCups}</span>
      </button>
      <Utility icon="icons/mail_64.png" label="邮件" style={{ left: 24, top: 101 }} dot={player.unread > 0} onClick={() => onOpen("mail")} />
      <Utility icon="icons/settings_64.png" label="设置" style={{ left: 399, top: 101 }} onClick={() => onOpen("settings")} />
      <MainButton
        asset="button/main_blue_210x70.png"
        icon="icons/swords_64.png"
        label="自由对战"
        style={{ left: 22, top: 350 }}
        pressed={pressed === "free"}
        onPress={setPressed}
        id="free"
        onClick={onFree}
      />
      <MainButton
        asset={rankAsset}
        icon={rankIcon}
        label="排位对决"
        style={{ left: 248, top: 350 }}
        pressed={pressed === "rank"}
        onPress={setPressed}
        id="rank"
        onClick={onRank}
      />
      <NavButton id="cards" label="卡牌" icon="icons/cards_64.png" style={{ left: 22, top: 435 }} pressed={pressed} setPressed={setPressed} onClick={() => onOpen("cards")} />
      <NavButton id="board" label="排行榜" icon="icons/trophy_64.png" style={{ left: 134, top: 435 }} pressed={pressed} setPressed={setPressed} onClick={() => onOpen("leaderboard")} />
      <NavButton id="season" label="赛季" icon="icons/crown_64.png" style={{ left: 246, top: 435 }} pressed={pressed} setPressed={setPressed} onClick={() => onOpen("season")} />
      <NavButton id="tasks" label="任务" icon="icons/gift_64.png" style={{ left: 358, top: 435 }} pressed={pressed} setPressed={setPressed} onClick={() => onOpen("tasks")} />
    </>
  );
}

function Subpage({
  page,
  player,
  board,
  region,
  onBack,
  onOpen,
  setBoard,
  setRegion,
  setPlayer,
  show,
}: {
  page: PageId;
  player: Player;
  board: "season" | "honor";
  region: "nation" | "province";
  onBack: () => void;
  onOpen: (page: PageId) => void;
  setBoard: (value: "season" | "honor") => void;
  setRegion: (value: "nation" | "province") => void;
  setPlayer: (value: Player) => void;
  show: (message: string) => void;
}) {
  return (
    <div className="absolute inset-0">
      <button type="button" aria-label="返回" className="absolute grid place-items-center" style={{ left: 16, top: 16, width: 54, height: 54 }} onClick={onBack}>
        <ScreenImage src={img("icons/back_64.png")} style={{ left: 8, top: 8, width: 36, height: 36 }} />
      </button>
      <div className="absolute inset-x-0 overflow-hidden px-6" style={{ top: 72, bottom: 16 }}>
        {page === "profile" ? <Profile player={player} onOpen={onOpen} /> : null}
        {page === "history" ? <History player={player} /> : null}
        {page === "season" ? <Season player={player} /> : null}
        {page === "honor" ? <Honor player={player} /> : null}
        {page === "mail" ? <Mail player={player} onRead={() => setPlayer({ ...player, unread: 0 })} /> : null}
        {page === "settings" ? <Settings player={player} setPlayer={setPlayer} onActivate={() => onOpen("activate")} /> : null}
        {page === "cards" ? <Cards /> : null}
        {page === "tasks" ? <Tasks /> : null}
        {page === "activate" ? <Activate player={player} setPlayer={setPlayer} show={show} /> : null}
        {page === "leaderboard" ? <Board board={board} region={region} setBoard={setBoard} setRegion={setRegion} /> : null}
      </div>
    </div>
  );
}

function Profile({ player, onOpen }: { player: Player; onOpen: (page: PageId) => void }) {
  return (
    <div>
      <PageTitle>个人主页</PageTitle>
      <div className="mt-3 flex items-center gap-3">
        <img src={img("avatar/avatar_crowned_64.png")} alt="" width={64} height={64} className="pixel" />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">{player.nickname}</p>
          <p className="text-sm text-[#a4c1d8]">UID {player.uid} · Lv.{player.level}</p>
          {player.title ? <p className="mt-1 inline-block rounded-full bg-[#ffc63b] px-2 py-0.5 text-xs font-semibold text-[#03152b]">{player.title}</p> : null}
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <Row icon="icons/trophy_64.png" title="历史杯数" value={String(player.historicalCups)} onClick={() => onOpen("history")} />
        <Row icon="icons/crown_64.png" title="本赛季" value={`${player.tier} ${player.seasonCups}`} onClick={() => onOpen("season")} />
        <Row icon="icons/honor_64.png" title="荣誉" value={player.title ? "查看称号" : "历史荣誉"} onClick={() => onOpen("honor")} />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#a4c1d8]">历史杯数不是本赛季奖杯。金币和名次只在演示数据里展示，正式值必须等服务器确认。</p>
    </div>
  );
}

function History({ player }: { player: Player }) {
  return (
    <div>
      <PageTitle>历史杯数</PageTitle>
      <p className="mt-2 text-4xl font-semibold">{player.historicalCups}</p>
      <p className="mt-1 text-sm text-[#a4c1d8]">旧版云端快照。不会当作当前赛季奖杯。</p>
      <div className="mt-4 grid gap-2 text-sm">
        <Info label="历史最高" value="1010" />
        <Info label="继承场次" value="128" />
        <Info label="数据来源" value="演示快照" />
      </div>
    </div>
  );
}

function Season({ player }: { player: Player }) {
  return (
    <div>
      <PageTitle>本赛季</PageTitle>
      <p className="mt-2 text-sm text-[#a4c1d8]">42 天。赛季奖杯单独计算，结束归档后重新开始。段位门槛以服务器配置为准，下面是演示档。</p>
      <div className="mt-4 grid gap-2 text-sm">
        <Info label="段位" value={player.tier} />
        <Info label="赛季奖杯" value={String(player.seasonCups)} />
        <Info label="段位榜名次" value={player.seasonRank ? `#${player.seasonRank} · 演示` : "未上榜"} />
        <Info label="结算" value="待服务器确认" />
      </div>
    </div>
  );
}

function Honor({ player }: { player: Player }) {
  return (
    <div>
      <PageTitle>荣誉</PageTitle>
      <div className="mt-3 rounded-2xl border border-[#41769e] bg-[#0a2744] p-3">
        <p className="text-xs text-[#a4c1d8]">现任称号</p>
        <p className="mt-1 text-lg font-semibold">{player.title ?? "没有已授予的现任称号"}</p>
        {player.title ? <p className="mt-1 text-xs text-[#ffc63b]">当前周有效 · 只展示服务端已授予的一个</p> : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <Info label="荣耀战力" value={`${player.honorPower} · 不按周清零`} />
        <Info label="全国 / 本省" value={player.nationRank && player.provinceRank ? `#${player.nationRank} / #${player.provinceRank} · 演示` : "待确认"} />
        <Info label="历史荣誉" value="2026-W10 全国 #1 · 已过期" />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#a4c1d8]">历史徽章不能显示成现任冠军。没有隐藏分。结榜时间为每周一北京时间 05:00。</p>
    </div>
  );
}

function Mail({ player, onRead }: { player: Player; onRead: () => void }) {
  return (
    <div>
      <PageTitle>邮件</PageTitle>
      <div className="mt-3 grid gap-2">
        <button type="button" className="rounded-2xl border border-[#41769e] bg-[#0a2744] p-3 text-left" onClick={onRead}>
          <p className="text-sm font-semibold">赛季说明 {player.unread ? "· 未读" : ""}</p>
          <p className="mt-1 text-xs leading-5 text-[#a4c1d8]">本赛季 42 天。段位榜不发放国省周称号。</p>
        </button>
        <div className="rounded-2xl border border-[#41769e] bg-[#0a2744] p-3">
          <p className="text-sm font-semibold">公告</p>
          <p className="mt-1 text-xs leading-5 text-[#a4c1d8]">正式排位、称号和奖杯都要等服务器确认。这封是演示邮件。</p>
        </div>
      </div>
    </div>
  );
}

function Settings({ player, setPlayer, onActivate }: { player: Player; setPlayer: (value: Player) => void; onActivate: () => void }) {
  return (
    <div>
      <PageTitle>设置</PageTitle>
      <div className="mt-3 grid gap-2 text-sm">
        <Info label="正式版" value={player.premium && player.verified ? "演示为已激活" : "未激活"} />
        <Info label="网络" value={player.online ? "在线" : "离线"} />
        <Info label="地区" value={`中国·${player.province} · 演示`} />
        <Info label="同步" value={player.online ? "缓存，待服务器刷新" : "离线缓存"} />
      </div>
      <button type="button" className="mt-4 min-h-11 w-full rounded-full bg-[#108cf6] text-sm font-semibold" onClick={onActivate}>
        激活正式版
      </button>
      <button
        type="button"
        className="mt-2 min-h-11 w-full rounded-full border border-[#41769e] text-sm"
        onClick={() => setPlayer({ ...player, online: !player.online })}
      >
        {player.online ? "演示切换为离线" : "演示切换为在线"}
      </button>
      <p className="mt-3 text-xs leading-5 text-[#a4c1d8]">修改地区不在手表里输入长地名，也不在这里生成假的付款二维码。</p>
    </div>
  );
}

function Cards() {
  return (
    <div>
      <PageTitle>卡牌</PageTitle>
      <div className="mt-3 grid gap-2 text-sm">
        <Info label="收藏" value="10 / 36" />
        <Info label="当前卡组" value="新手 10 张 · Lv.1" />
        <Info label="说明" value="进入页面不会重发新手卡" />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#a4c1d8]">自由对战和排位都不会打开选模式页。卡牌升级收益以服务器规则为准。</p>
    </div>
  );
}

function Tasks() {
  const items = [
    ["完成 1 场自由对战", "演示"],
    ["查看赛季说明", "演示"],
    ["保持卡组 10 张", "已完成"],
  ];
  return (
    <div>
      <PageTitle>任务</PageTitle>
      <div className="mt-3 grid gap-2">
        {items.map(([name, state]) => (
          <div key={name} className="flex items-center justify-between rounded-2xl border border-[#41769e] bg-[#0a2744] px-3 py-3 text-sm">
            <span>{name}</span>
            <span className="text-[#a4c1d8]">{state}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-[#a4c1d8]">没有周积分。荣耀战力不会在周一清零。</p>
    </div>
  );
}

function Activate({ player, setPlayer, show }: { player: Player; setPlayer: (value: Player) => void; show: (message: string) => void }) {
  return (
    <div>
      <PageTitle>激活正式版</PageTitle>
      <p className="mt-3 text-sm leading-6 text-[#a4c1d8]">未激活也可以玩自由 AI。正式排位、荣耀称号和以后的真人对战需要永久激活，并且每次开打前还要联网核验。</p>
      <button
        type="button"
        className="mt-4 min-h-11 w-full rounded-full bg-[#ffc63b] text-sm font-semibold text-[#03152b]"
        onClick={() => {
          setPlayer({ ...player, premium: true, verified: true });
          show("这是本地演示标记，不是服务器确认。排位按钮会变成可点，但开打仍会停在核验，不会记战绩。");
        }}
      >
        演示：标记为已激活
      </button>
    </div>
  );
}

function Board({
  board,
  region,
  setBoard,
  setRegion,
}: {
  board: "season" | "honor";
  region: "nation" | "province";
  setBoard: (value: "season" | "honor") => void;
  setRegion: (value: "nation" | "province") => void;
}) {
  const rows = board === "season"
    ? [["星海旅人", "860 杯"], ["北港", "790 杯"], ["晚潮", "640 杯"]]
    : region === "nation"
      ? [["星海旅人", "480 战力"], ["北港", "455 战力"], ["晚潮", "420 战力"]]
      : [["星海旅人", "480 战力"], ["晚潮", "420 战力"], ["南湾", "300 战力"]];
  return (
    <div>
      <PageTitle>排行榜</PageTitle>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tab on={board === "season"} onClick={() => setBoard("season")}>段位榜</Tab>
        <Tab on={board === "honor"} onClick={() => setBoard("honor")}>荣耀榜</Tab>
      </div>
      {board === "honor" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Tab on={region === "nation"} onClick={() => setRegion("nation")}>全国</Tab>
          <Tab on={region === "province"} onClick={() => setRegion("province")}>本省</Tab>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-[#a4c1d8]">{board === "honor" ? "同一个荣耀战力，只是地区不同。暂列名次不是本周冠军。" : "按赛季奖杯。段位榜不发周称号。"} 以下是演示名次。</p>
      <div className="mt-2 grid gap-2">
        {rows.map(([name, score], index) => (
          <div key={name} className="flex items-center justify-between rounded-2xl border border-[#41769e] bg-[#0a2744] px-3 py-2 text-sm">
            <span>{index + 1} {name}</span>
            <span>{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageTitle({ children }: { children: string }) {
  return <h1 className="text-center text-[26px] font-semibold tracking-tight">{children}</h1>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#41769e] bg-[#0a2744] px-3 py-3">
      <span className="text-[#a4c1d8]">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Row({ icon, title, value, onClick }: { icon: string; title: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="relative h-[55px] w-full text-left" onClick={onClick}>
      <ScreenImage src={img("panel/detail_row_418x55.png")} style={{ left: 0, top: 0, width: "100%", height: 55 }} />
      <img src={img(icon)} alt="" width={28} height={28} className="pixel absolute" style={{ left: 14, top: 13 }} />
      <span className="absolute text-sm" style={{ left: 52, top: 16 }}>{title}</span>
      <span className="absolute text-sm text-[#ffc63b]" style={{ right: 16, top: 16 }}>{value}</span>
    </button>
  );
}

function Tab({ on, children, onClick }: { on: boolean; children: string; onClick: () => void }) {
  return (
    <button type="button" className={`min-h-10 rounded-full text-sm ${on ? "bg-[#108cf6]" : "border border-[#41769e]"}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Utility({ icon, label, style, dot, onClick }: { icon: string; label: string; style: { left: number; top: number }; dot?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} className="absolute" style={{ ...style, width: 58, height: 58 }} onClick={onClick}>
      <ScreenImage src={img("button/utility_58x58.png")} style={{ left: 0, top: 0, width: 58, height: 58 }} />
      <ScreenImage src={img(icon)} style={{ left: 13, top: 13, width: 32, height: 32 }} />
      {dot ? <ScreenImage src={img("panel/unread_dot_22.png")} style={{ right: -2, top: -2, width: 22, height: 22 }} /> : null}
    </button>
  );
}

function MainButton({
  asset,
  icon,
  label,
  style,
  id,
  pressed,
  onPress,
  onClick,
}: {
  asset: string;
  icon: string;
  label: string;
  style: { left: number; top: number };
  id: string;
  pressed: boolean;
  onPress: (id: string) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="absolute"
      style={{ ...style, width: 210, height: 70 }}
      onPointerDown={() => onPress(id)}
      onPointerUp={() => onPress("")}
      onPointerLeave={() => onPress("")}
      onClick={onClick}
    >
      <ScreenImage src={img(asset)} style={{ left: 0, top: 0, width: 210, height: 70, filter: pressed ? "brightness(1.15)" : undefined }} />
      <ScreenImage src={img(icon)} style={{ left: 28, top: 19, width: 32, height: 32 }} />
      <span className="absolute text-[22px] font-semibold" style={{ left: 70, top: 20 }}>{label}</span>
    </button>
  );
}

function NavButton({
  id,
  label,
  icon,
  style,
  pressed,
  setPressed,
  onClick,
}: {
  id: string;
  label: string;
  icon: string;
  style: { left: number; top: number };
  pressed: string;
  setPressed: (id: string) => void;
  onClick: () => void;
}) {
  const down = pressed === id;
  return (
    <button
      type="button"
      className="absolute"
      style={{ ...style, width: 100, height: 94 }}
      onPointerDown={() => setPressed(id)}
      onPointerUp={() => setPressed("")}
      onPointerLeave={() => setPressed("")}
      onClick={onClick}
    >
      <ScreenImage src={img(down ? "button/nav_pressed_100x94.png" : "button/nav_normal_100x94.png")} style={{ left: 0, top: 0, width: 100, height: 94 }} />
      <ScreenImage src={img(icon)} style={{ left: 34, top: 14, width: 32, height: 32 }} />
      <span className="absolute inset-x-0 text-center text-[15px]" style={{ top: 54 }}>{label}</span>
    </button>
  );
}

function ScreenImage({ src, style }: { src: string; style: CSSProperties }) {
  return <img src={src} alt="" draggable={false} className="pixel pointer-events-none absolute" style={style} />;
}
