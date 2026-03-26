// pages/index.tsx
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DonationWidget from '../components/DonationWidget';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import type { PageSeoMeta } from '../lib/seoConfig';
/* ======= Minimal i18n (zh/en) injection: BEGIN ======= */
type Lang = 'zh' | 'en';
const LangContext = createContext<Lang>('zh');
const SeatInfoContext = createContext<string[] | null>(null);

const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    Title: '斗地主 · Fight the Landlord',
    TotalMatches: '所有参赛选手累计局数',
    DisclaimerButton: '免责声明',
    DisclaimerClose: '关闭免责声明',
    BlogButton: '平台博客',
    BlogClose: '关闭博客窗口',
    DiscordButton: 'Discord 社区',
    DiscordClose: '关闭 Discord 窗口',
    DeveloperJoinButton: '开发者加入',
    DeveloperJoinClose: '关闭开发者加入窗口',
    Settings: '对局设置',
    Enable: '启用对局',
    Reset: '清空',
    EnableHint: '关闭后不可开始/继续对局；再次勾选即可恢复。',
    LadderTitle: '积分',
    LadderSubtitle: '活动积分 ΔR',
    LadderRange: '范围 ±K，按局面权重加权，当前 K≈{K}；未参赛=历史或0',
    LadderPlaysTitle: '累计局数',
    Pass: '过',
    Play: '出牌',
    Empty: '（空）',
    Upload: '上传',
    Save: '存档',
    FarmerCoop: '农民配合',
  },
  en: {
    Title: 'Fight the Landlord',
    TotalMatches: 'Total games played by all participants',
    DisclaimerButton: 'Disclaimer',
    DisclaimerClose: 'Close disclaimer',
    BlogButton: 'Blog',
    BlogClose: 'Close blog dialog',
    DiscordButton: 'Discord',
    DiscordClose: 'Close Discord dialog',
    DeveloperJoinButton: 'Join as Developer',
    DeveloperJoinClose: 'Close developer join dialog',
    Settings: 'Match settings',
    Enable: 'Enable match',
    Reset: 'Reset',
    EnableHint: 'Disabled matches cannot start/continue; tick again to restore.',
    LadderTitle: 'Points',
    LadderSubtitle: 'Activity ΔR',
    LadderRange: 'Range ±K, weighted by situation; current K≈{K}; no participation uses history or 0',
    LadderPlaysTitle: 'Games played',
    Pass: 'Pass',
    Play: 'Play',
    Empty: '(empty)',
    Upload: 'Upload',
    Save: 'Save',
    FarmerCoop: 'Farmer cooperation',}
};

function useI18n() {
  const lang = useContext(LangContext);
  const t = (key: string, vars: Record<string, any> = {}) => {
    let s = (I18N[lang]?.[key] ?? I18N.zh[key] ?? key);
    s = s.replace(/\{(\w+)\}/g, (_: any, k: string) => (vars[k] ?? `{${k}}`));
    return s;
  };
  return { lang, t };
}

function seatLabel(i: number, lang: Lang) {
  return (lang === 'en' ? ['A', 'B', 'C'] : ['甲', '乙', '丙'])[i] || String(i);
}
/* ======= Minimal i18n (zh/en) injection: END ======= */

/* ======= UI auto-translation utilities (DOM walker) ======= */
type TransRule = { zh: string | RegExp; en: string };

const TRANSLATIONS: TransRule[] = [
  { zh: '存档', en: 'Save' },
  { zh: '上传', en: 'Upload' },
  { zh: '下载', en: 'Download' },
  { zh: '导出', en: 'Export' },
  { zh: '导入', en: 'Import' },
  { zh: '刷新', en: 'Refresh' },
  { zh: '运行日志', en: 'Run Log' },
  { zh: '对局设置', en: 'Match settings' },
  { zh: '启用对局', en: 'Enable match' },
  { zh: '清空', en: 'Reset' },
  { zh: '出牌', en: 'Play' },
  { zh: '过', en: 'Pass' },
  { zh: '（空）', en: '(empty)' },
  { zh: '地主', en: 'Landlord' },
  { zh: '农民', en: 'Farmer' },
  { zh: '农民配合', en: 'Farmer cooperation' },
  { zh: '开始', en: 'Start' },
  { zh: '暂停', en: 'Pause' },
  { zh: '继续', en: 'Resume' },
  { zh: '停止', en: 'Stop' },
  { zh: '天梯图', en: 'Ladder' },
  { zh: '活动积分', en: 'ΔR' },
  { zh: '范围', en: 'Range' },
  { zh: '当前', en: 'Current' },
  { zh: '未参赛', en: 'Not played' },
  { zh: '历史', en: 'History' },

  // === Added for full UI coverage ===
  { zh: '局数', en: 'Rounds' },
  { zh: '初始分', en: 'Initial Score' },
  { zh: /4带2\s*规则/, en: '4-with-2 Rule' },
  { zh: '都可', en: 'Allowed' },
  { zh: '不可', en: 'Not allowed' },
  { zh: '选择', en: 'Select' },
  { zh: /每家AI设置（独立）|每家AI设置\s*\(独立\)/, en: 'Per-player AI (independent)' },
  { zh: /每家出牌最小间隔（ms）|每家出牌最小间隔\s*\(ms\)/, en: 'Per-player min play interval (ms)' },
  { zh: /每家思考超时（秒）|每家思考超时\s*\(秒\)/, en: 'Per-player think timeout (s)' },
  { zh: /最小间隔（ms）|最小间隔\s*\(ms\)/, en: 'Min interval (ms)' },
  { zh: /弃牌时间（秒）|弃牌时间\s*\(秒\)/, en: 'Discard time (s)' },
  { zh: /（独立）|\(独立\)/, en: '(independent)' },
  { zh: /（ms）|\(ms\)/, en: '(ms)' },
  { zh: /（秒）|\(秒\)/, en: '(s)' },
  { zh: /天梯\s*\/\s*TrueSkill/, en: 'Ladder / TrueSkill' },
  { zh: '可抢地主', en: 'Outbid the landlord' },
  { zh: '局', en: 'round(s)' },
  { zh: '开始', en: 'Start' },
  { zh: '暂停', en: 'Pause' },
  { zh: '继续', en: 'Resume' },
  { zh: '停止', en: 'Stop' },


  // === Added for extended UI coverage (batch 2) ===
  { zh: '甲', en: 'A' },
  { zh: '乙', en: 'B' },
  { zh: '丙', en: 'C' },

  { zh: '对局', en: 'Match' },
  { zh: /TrueSkill（实时）|TrueSkill\s*\(实时\)/, en: 'TrueSkill (live)' },
  { zh: /当前使用：?/, en: 'Current: ' },
  { zh: '总体档', en: 'Overall' },

  { zh: /战术画像（累计，0[-~~—––]5）|战术画像（累计，0~5）|战术画像\s*\(累计[,，]?\s*0\s*[-–~]\s*5\)/, en: 'Tactical profile (cumulative, 0–5)' },
  { zh: /汇总方式\s*指数加权（推荐）|汇总方式\s*指数加权\s*\(推荐\)/, en: 'Aggregation: exponentially weighted (recommended)' },

  { zh: /出牌评分（每局动态）|出牌评分\s*\(每局动态\)/, en: 'Play score (per hand, dynamic)' },
  { zh: /评分统计（每局汇总）|评分统计\s*\(每局汇总\)/, en: 'Score stats (per hand, summary)' },

  { zh: '最近一局均值：', en: 'Last-hand mean: ' },
  { zh: '最好局均值：', en: 'Best-hand mean: ' },
  { zh: '最差局均值：', en: 'Worst-hand mean: ' },
  { zh: '总体均值：', en: 'Overall mean: ' },
  { zh: '局数：', en: 'Hands: ' },

  { zh: '手牌', en: 'Cards on hand' },
  { zh: '结果', en: 'Result' },
  { zh: '倍数', en: 'Multiplier' },
  { zh: '胜者', en: 'Winner' },
  { zh: '本局加减分', en: 'Points this hand' },

  { zh: /（尚无出牌）|\(尚无出牌\)/, en: '(no plays yet)' },

  { zh: '剩余局数：', en: 'Remaining hands: ' },
  { zh: '剩余局数', en: 'Remaining hands' },


  // === Added for extended UI coverage (batch 3) ===
  { zh: /每家\s*AI\s*设置/, en: 'Per-player AI settings' },
  { zh: /（独立）/, en: '(independent)' },
  { zh: /\(独立\)/, en: '(independent)' },

  { zh: '总体档', en: 'Overall' },
  { zh: /总体(?!均值)/, en: 'Overall' },

  { zh: '汇总方式', en: 'Aggregation' },
  { zh: '指数加权（推荐）', en: 'Exponentially weighted (recommended)' },
  { zh: /\(推荐\)/, en: '(recommended)' },
  { zh: /越大越看重最近几局/, en: 'Larger value emphasizes recent hands' },
  { zh: /（等待至少一局完成后生成累计画像）/, en: '(Generated after at least one hand completes)' },
  { zh: /\(等待至少一局完成后生成累计画像\)/, en: '(Generated after at least one hand completes)' },

  { zh: /横轴[:：]\s*/, en: 'X-axis: ' },
  { zh: /纵轴[:：]\s*/, en: 'Y-axis: ' },
  { zh: /第几手牌/, en: 'hand index' },


  // === Added for extended UI coverage (batch 4) ===
  { zh: /按[“\"“]?内置\/AI\+模型\/版本\(\+HTTP Base\)[”\"”]?识别，并区分地主\/农民。?/, en: 'Recognize by "built-in/AI+model/version (+HTTP Base)" and distinguish Landlord/Farmer.' },
  { zh: /说明[:：]\s*CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。?/, en: 'Note: CR is the lower confidence bound (higher is more stable); updates after each hand (also supports backend-pushed TS).' },
  { zh: /每局开始时底色按[“\"“]?本局地主[”\"”]?的线色变化提示；上传文件可替换\/叠加历史，必要时点[“\"“]?刷新[”\"”]?。?/, en: 'At the start of each hand, background follows the current Landlord color; uploads can replace/append history; click "Refresh" if needed.' },
  { zh: /α/, en: 'alpha' },  // symbol label near alpha
  { zh: /指数加权（推荐）/, en: 'Exponentially weighted (recommended)' },
  { zh: /当前使用[:：]\s*/, en: 'Current: ' },
  { zh: /总体档/, en: 'Overall' },
  { zh: /总体(?!均值)/, en: 'Overall' },

  { zh: '关闭后不可开始/继续对局；再次勾选即可恢复。', en: 'Disabled matches cannot start/continue; tick again to restore.' },
];
function hasChinese(s: string) { return /[\u4e00-\u9fff]/.test(s); }

type DisclaimerSection = { title: string; paragraphs: string[] };

const DISCLAIMER_CONTENT: Record<Lang, { title: string; sections: DisclaimerSection[] }> = {
  en: {
    title: 'AI Battle Platform (Fight the Landlord)',
    sections: [
      {
        title: 'Scope',
        paragraphs: [
          'This compliance statement and terms of use apply to an AI battle website or app (the “Platform”) built around the Fight the Landlord card game. The Platform calls artificial-intelligence models from multiple providers to create bots that play the game, evaluate performance, and display leaderboards. The service is for research, testing and entertainment only. It does not offer gambling, lotteries or paid wagering and in no way encourages users to base real-world monetary transactions or decisions on match outcomes.',
        ],
      },
      {
        title: 'AI models & providers',
        paragraphs: [
          'The Platform uses AI models from third-party providers, including but not limited to OpenAI (e.g. gpt-4o-mini), Google (Gemini series), Anthropic (Claude series), Alibaba (Qwen series), Kimi, DeepSeek, Grok, and Platform-developed or open-source strategies such as Greedy Max, Greedy Min, Random Legal, MiniNet, AllySupport and others.',
          'Model names appear in match settings and leaderboards solely to differentiate the origin of each algorithm. They do not imply sponsorship, endorsement or authorization by the model owners.',
          'The Platform accesses these models under their respective providers’ terms of service and holds only a non-transferable right to use them. It does not own the models or have the right to sublicense them, and makes no warranty regarding the accuracy, legality or suitability of model outputs.',
          'The Platform will not reproduce, redistribute or sell model outputs, nor use providers’ brand names for promotional purposes. Commercial use of model outputs requires separate authorization from the relevant provider.',
        ],
      },
      {
        title: 'Game rights',
        paragraphs: [
          'Fight the Landlord is a widely known card game whose rules and name may be subject to trademarks or copyrights held by third parties. The Platform implements the game according to common public rules for the sole purpose of demonstrating algorithms. No cooperation or licensing relationship exists between the Platform and any rights holder.',
          'The user interface, charts and statistical displays are original works created by the Platform and are protected by copyright. No one may reproduce, modify or republish the Platform’s code, images, text or statistics for commercial purposes without written permission.',
        ],
      },
      {
        title: 'User-defined bots & HTTP API',
        paragraphs: [
          'The Platform may allow developers to upload or link custom bot code (for example via an HTTP API). All uploaded or linked code must comply with applicable laws and regulations and must not contain malware, trojans, crypto-mining scripts or any content infringing others’ rights.',
          'The Platform assumes no responsibility for issues arising from user-supplied code, including intellectual-property disputes, illegal activity or damage caused by such code. Users must ensure they have the legal right to the code they provide and accept full liability for any resulting claims.',
          'The Platform reserves the right to perform security checks on uploaded code. It may delete or block code deemed illegal or unsafe, and may report suspected violations to authorities.',
        ],
      },
      {
        title: 'User conduct rules',
        paragraphs: [
          'Users must comply with the laws and regulations of their jurisdiction. It is forbidden to use the Platform to spread illegal content, infringe intellectual property or privacy rights, or engage in betting, fraud, system attacks or other unlawful acts.',
          'Users may not falsely claim that they represent the Platform or any provider, nor may they use the Platform’s or providers’ names to advertise, promote or solicit cooperation. Any implication of endorsement is strictly prohibited.',
          'Users may not use Platform leaderboards, scores or match statistics for advertising, commercial ranking or misleading comparisons. Anyone quoting results must specify the data source and experimental conditions.',
          'The Platform may temporarily or permanently restrict access for users who violate these rules, and reserves the right to pursue legal action.',
        ],
      },
      {
        title: 'Scoring & leaderboard disclaimer',
        paragraphs: [
          'The Platform displays scores, cumulative games, TrueSkill ratings, thinking-time statistics, strategy charts and other metrics. These reflect AI strategies or models under specific parameters and conditions only, and do not represent general performance of those models or any provider’s official evaluation.',
          'AI performance will vary with model versions, API conditions and network factors, so results will differ over time. The Platform accepts no liability for the accuracy, timeliness or suitability of its statistics.',
          'Individuals or organizations must not use leaderboard data for commercial rankings or advertising. If data are quoted, the source and conditions must be clearly identified.',
        ],
      },
      {
        title: 'Disclaimer',
        paragraphs: [
          'AI match results and analyses are for entertainment and research purposes only; they do not evaluate or recommend real human players, organizations or AI providers.',
          'The Platform does not warrant the correctness, completeness or timeliness of all content. Users assume all risk and responsibility for using Platform content.',
          'The Platform may link to third-party websites or APIs. Such links are provided for convenience and do not constitute endorsement. Visiting third-party sites is subject to their own terms of use and privacy policies.',
        ],
      },
      {
        title: 'Privacy & data handling',
        paragraphs: [
          'The Platform respects user privacy and processes personal data in accordance with applicable data-protection laws. Basic browsing does not require registration. Functions like uploading bot code or saving match logs may require registration information (nickname, email, etc.), collected only to provide services and improve user experience.',
          'Reasonable technical and organizational measures are taken to protect data security. The Platform will not sell or disclose personal data without user consent except as required by law.',
          'User-generated data may be analyzed for non-commercial research purposes without obtaining additional consent and will not be used for commercial exploitation.',
          'Users may request deletion of their personal data or account at any time. The Platform will process such requests within a reasonable period while retaining necessary business records as permitted by law.',
        ],
      },
      {
        title: 'Governing law & dispute resolution',
        paragraphs: [
          'These terms are governed by the laws of the jurisdiction where the Platform operates. If any term conflicts with mandatory law, the latter prevails and the remaining provisions remain effective.',
          'Disputes arising from use of the Platform shall first be resolved through amicable negotiation. If negotiation fails, the dispute shall be submitted to the competent court in the Platform’s place of operation.',
        ],
      },
      {
        title: 'Contact',
        paragraphs: [
          'If you have questions, complaints or suggestions regarding this statement or the Platform, please contact us:',
          'Email: ai-gaming.online@outlook.com',
          'We will respond and handle your request within a reasonable time.',
        ],
      },
    ],
  },
  zh: {
    title: 'AI 对战平台（斗地主）',
    sections: [
      {
        title: '一、适用范围',
        paragraphs: [
          '本合规声明与使用条款适用于围绕“斗地主”纸牌游戏构建的 AI 对战网站或应用（以下简称“本平台”）。',
          '本平台通过调用多个 AI 模型服务商的人工智能模型创建游戏机器人，用于游戏对战、性能评估和排行榜展示。',
          '该服务仅用于科研、测试与娱乐目的。平台不提供赌博、抽奖或付费下注功能，且绝不鼓励用户基于比赛结果进行任何现实中的金钱交易或决策。',
        ],
      },
      {
        title: '二、AI 模型与服务提供方',
        paragraphs: [
          '本平台使用来自第三方提供商的人工智能模型，包括但不限于：OpenAI（如 gpt-4o-mini）、Google（Gemini 系列）、Anthropic（Claude 系列）、阿里巴巴（Qwen 系列）、Kimi、DeepSeek、Grok，以及平台自研或开源的策略算法，如 Greedy Max、Greedy Min、Random Legal、MiniNet、AllySupport 等。',
          '模型名称在比赛设置与排行榜中仅用于区分算法来源，不代表该模型所有者的赞助、认可或授权。',
          '平台根据各服务商的服务条款访问这些模型，仅享有不可转让的使用权。平台不拥有这些模型，也无权转授权，亦不对模型输出的准确性、合法性或适用性作出任何保证。',
          '平台不会复制、再分发或销售模型输出内容，也不会将服务商品牌用于推广目的。任何商业化使用模型输出的行为均需获得相应服务商的独立授权。',
        ],
      },
      {
        title: '三、游戏版权',
        paragraphs: [
          '“斗地主”是一款广为人知的纸牌游戏，其规则或名称可能受第三方的商标或著作权保护。本平台仅基于公开通用的规则实现该游戏，用于算法演示与研究之目的。平台与任何版权持有人之间不存在合作或授权关系。',
          '平台的用户界面、图表与统计展示均为原创作品，受著作权保护。未经书面许可，任何人不得将平台的代码、图片、文字或统计数据用于商业再发布、修改或再传播。',
        ],
      },
      {
        title: '四、用户自定义机器人与 HTTP API',
        paragraphs: [
          '平台可能允许开发者上传或链接自定义机器人代码（例如通过 HTTP API）。所有上传或链接的代码必须遵守相关法律法规，且不得包含恶意软件、木马、挖矿脚本或侵犯他人权益的内容。',
          '平台对用户提交代码引发的任何问题不承担责任，包括但不限于知识产权纠纷、违法行为或由该代码造成的损害。用户应确保对所提供代码拥有合法使用权，并对因此产生的任何索赔承担全部责任。',
          '平台保留对上传代码进行安全检查的权利。若发现代码涉嫌违法或不安全，平台有权删除、屏蔽并向有关部门报告。',
        ],
      },
      {
        title: '五、用户行为规范',
        paragraphs: [
          '用户必须遵守其所在司法辖区的法律法规。严禁利用平台传播非法内容、侵犯知识产权或隐私权、从事赌博、欺诈、系统攻击等违法行为。',
          '用户不得冒充平台或任何服务商代表，也不得使用平台或服务商名称进行广告、推广或商业合作邀约。任何暗示平台或服务商背书的行为均被严格禁止。',
          '用户不得将平台的排行榜、得分或比赛统计用于广告、商业排名或误导性比较。如需引用数据，必须明确标注数据来源及实验条件。',
          '平台有权对违反规则的用户暂时或永久限制访问，并保留追究法律责任的权利。',
        ],
      },
      {
        title: '六、评分与排行榜免责声明',
        paragraphs: [
          '平台展示的分数、对局次数、TrueSkill 等级、思考时间统计、策略图表及其他指标，仅反映特定条件下 AI 策略或模型的表现，不代表模型或其提供商的整体性能或官方评估。',
          'AI 表现会随模型版本、API 状况及网络因素而变化，结果随时间可能不同。平台不保证其统计结果的准确性、时效性或适用性。',
          '任何个人或机构不得将排行榜数据用于商业排名或广告宣传。若引用数据，必须注明来源及实验条件。',
        ],
      },
      {
        title: '七、免责声明',
        paragraphs: [
          'AI 对战结果与分析仅供娱乐与研究使用，不用于评估或推荐任何真人玩家、机构或 AI 服务商。',
          '平台不保证内容的正确性、完整性或时效性。用户使用平台内容的风险与责任均由其自行承担。',
          '平台可能包含指向第三方网站或 API 的链接，这些链接仅为方便访问，不代表平台的认可或推荐。访问第三方网站应遵守其各自的使用条款与隐私政策。',
        ],
      },
      {
        title: '八、隐私与数据处理',
        paragraphs: [
          '平台尊重用户隐私，并依据适用的数据保护法律处理个人数据。基本浏览无需注册；若使用上传机器人代码或保存对局记录等功能，可能需要提供注册信息（如昵称、邮箱等），此类信息仅用于提供服务与提升用户体验。',
          '平台采取合理的技术与组织措施保障数据安全。除法律要求外，平台不会在未经用户同意的情况下出售或披露个人数据。',
          '用户产生的数据可用于非商业研究用途，无需事先征得用户同意，且不会用于商业化利用。',
          '用户可随时请求删除其个人数据或账户，平台将在合理期限内处理该请求，同时保留法律允许范围内的必要业务记录。',
        ],
      },
      {
        title: '九、适用法律与争议解决',
        paragraphs: [
          '本条款受平台运营所在地法律管辖。若本条款与强制性法律相冲突，以强制性法律为准，其余条款仍保持有效。',
          '因使用平台产生的争议，应首先通过友好协商解决；协商不成的，提交平台运营地有管辖权的法院处理。',
        ],
      },
      {
        title: '十、联系方式',
        paragraphs: [
          '如您对本声明或平台有任何疑问、投诉或建议，请联系：',
          '邮箱：ai-gaming.online@outlook.com',
          '平台将在合理时间内予以回复与处理。',
        ],
      },
    ],
  },
};

type DeveloperJoinListItem = string | { prefix?: string; text: string };
type DeveloperJoinBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; title: string; items: DeveloperJoinListItem[] };

type DeveloperJoinContent = {
  title: string;
  blocks: DeveloperJoinBlock[];
};

type BlogPost = {
  id: string;
  title: string;
  date: string;
  paragraphs: string[];
  tags?: string[];
};

type BlogContent = {
  title: string;
  intro?: string[];
  posts: BlogPost[];
};

type DiscordChannel = {
  id: string;
  name: string;
  description: string;
  link?: string;
};

type DiscordSection = {
  heading: string;
  items: DiscordChannel[];
};

type DiscordContent = {
  title: string;
  intro?: string[];
  serverName: string;
  inviteText: string;
  inviteUrl: string;
  inviteNote?: string;
  sections: DiscordSection[];
  footer?: string[];
};

const DEVELOPER_JOIN_CONTENT: Record<Lang, DeveloperJoinContent> = {
  zh: {
    title: '开发者加入',
    blocks: [
      {
        kind: 'paragraph',
        text: '平台愿景说明',
      },
      {
        kind: 'paragraph',
        text: 'By AI, For People',
      },
      {
        kind: 'paragraph',
        text:
          '我们的核心目标是构建一个由 AI 自身驱动的多模型竞技与算法评测开放社区，聚焦斗地主 AI 竞技项目。通过在平台中的博弈与对战，促进不同 AI 模型的协同进化与能力提升，以 AI 之力，造福人类。',
      },
      {
        kind: 'paragraph',
        text:
          '我们鼓励开发者尽可能采用 Prompt 驱动 的方式，让各类 AI 模型自主完成代码编写、调试与对战，从而实现真正意义上的 “AI 以代码论高下” 的实验与交流。',
      },
      {
        kind: 'paragraph',
        text: '在提交或更新代码时，请注明所使用的 AI 工具或模型，以便社区共同了解不同模型的表现与特性。',
      },
      {
        kind: 'paragraph',
        text: '当前平台的基础版本由作者通过 Codex 编写实现。受限于个人能力与实现范围，现有版本并不代表 Codex 的全部潜力。',
      },
      {
        kind: 'paragraph',
        text: '我们诚挚欢迎更多开发者使用不同的 AI 工具参与，共同完善和拓展这一开放的 AI 对战与评测生态。',
      },
      {
        kind: 'list',
        title: '🔗 项目托管',
        items: [
          { prefix: 'GitHub 仓库：', text: 'https://github.com/woshisimox/Fight-the-Landlord' },
          '部署平台： Vercel',
        ],
      },
      {
        kind: 'list',
        title: '👩‍💻 如何参与',
        items: [
          'Fork 仓库，创建分支后提交 Pull Request',
          '参与前可查看 README.md、CONTRIBUTING.md 与 issues',
          '欢迎提交：',
          '· 新算法 / AI 接口适配',
          '· UI/UX 优化',
          '· TrueSkill / Ladder 评分改进',
          '· 调试、日志与对战回放模块',
        ],
      },
      {
        kind: 'list',
        title: '💬 交流与支持',
        items: [
          '提交 Issue 或 Discussion',
          '可通过 GitHub 联系维护者：@woshisimox',
          { prefix: '或通过邮件联系：', text: 'ai-gaming.online@outlook.com' },
        ],
      },
      {
        kind: 'list',
        title: '🧠 当前技术栈',
        items: [
          '前端：Next.js + TypeScript + TailwindCSS',
          '后端：Node.js（Vercel Serverless）',
          '数据存储：本地 JSON / GitHub Pages 同步（后续支持 Cloud DB）',
        ],
      },
      {
        kind: 'list',
        title: '📜 许可协议',
        items: [
          '代码采用 MIT License 开源',
          '欢迎任何形式的学习、改进与二次开发，但请保留署名',
        ],
      },
    ],
  },
  en: {
    title: 'Join as a Developer',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Platform Vision Statement',
      },
      {
        kind: 'paragraph',
        text: 'By AI, For People.',
      },
      {
        kind: 'paragraph',
        text:
          "Our core goal is to build an AI-driven open community for multi-model competitions and algorithm evaluation focused on Fight the Landlord. Through strategic matchups and battles on the platform, we aim to foster collaborative evolution and capability growth across different AI models so that AI advancements benefit humanity.",
      },
      {
        kind: 'paragraph',
        text:
          'We encourage developers to adopt prompt-driven workflows so that diverse AI models can independently handle coding, debugging, and matches, enabling truly “AI proves itself through code” experimentation and exchange.',
      },
      {
        kind: 'paragraph',
        text: 'When submitting or updating code, please note the AI tools or models you used so the community can understand each model’s performance and characteristics.',
      },
      {
        kind: 'paragraph',
        text: 'The foundational version of this platform was implemented by the maintainer using Codex. Due to individual limitations, the current build does not represent the full potential of Codex.',
      },
      {
        kind: 'paragraph',
        text: 'We warmly welcome more developers to participate with diverse AI tools and help refine and expand this open ecosystem for AI battles and evaluation.',
      },
      {
        kind: 'list',
        title: '🔗 Project Hosting',
        items: [
          { prefix: 'GitHub Repository:', text: 'https://github.com/woshisimox/Fight-the-Landlord' },
          'Deployment Platform: Vercel',
        ],
      },
      {
        kind: 'list',
        title: '👩‍💻 How to Participate',
        items: [
          'Fork the repository, create a branch, and submit a Pull Request.',
          'Review README.md, CONTRIBUTING.md, and issues before contributing.',
          'We welcome submissions including:',
          '· New algorithms / AI interface integrations',
          '· UI/UX improvements',
          '· TrueSkill / ladder scoring enhancements',
          '· Debugging, logging, and match replay modules',
        ],
      },
      {
        kind: 'list',
        title: '💬 Communication & Support',
        items: [
          'Open an Issue or Discussion',
          'Reach the maintainer on GitHub: @woshisimox',
          { prefix: 'Contact via email:', text: 'ai-gaming.online@outlook.com' },
        ],
      },
      {
        kind: 'list',
        title: '🧠 Current Tech Stack',
        items: [
          'Frontend: Next.js + TypeScript + TailwindCSS',
          'Backend: Node.js (Vercel Serverless)',
          'Data Storage: Local JSON / GitHub Pages sync (Cloud DB support coming later)',
        ],
      },
      {
        kind: 'list',
        title: '📜 License',
        items: [
          'Code released under the MIT License',
          'Feel free to learn, improve, or build upon it—please keep attribution.',
        ],
      },
    ],
  },
};

const BLOG_CONTENT: Record<Lang, BlogContent> = {
  zh: {
    title: '平台博客',
    intro: [
      '欢迎来到 AI Battle Platform 的开发日志。在这里我们会分享平台演进的重点规划、近期里程碑，以及 AI 对战社区正在探索的新方向。',
    ],
    posts: [
      {
        id: 'vision-and-roadmap',
        title: 'AI Battle Platform 愿景与路线图快照',
        date: '2025-10-01',
        paragraphs: [
          'AI Battle Platform（ai-gaming.online）正在持续扩展斗地主项目的 AI 竞技能力。我们致力于打造一个“By AI, For People”的开放实验场，支持开发者使用提示词驱动的方式，让各类模型在真实牌局中持续迭代。',
          '近期我们重点完成了对赛后日志的邮件分发能力、基础 SEO 与 sitemap 构建，并持续优化 TrueSkill / Ladder 指标的可视化体验。接下来我们会逐步引入更多 AI 适配接口与回放工具，欢迎关注 GitHub 仓库 https://github.com/woshisimox/Fight-the-Landlord 并参与讨论。',
        ],
        tags: ['愿景', '路线图', '平台更新'],
      },
      {
        id: 'community-call',
        title: '社区征集：共建 AI 对战生态',
        date: '2025-10-07',
        paragraphs: [
          '我们正在招募更多开发者与研究者，一起完善斗地主项目的 AI 对战体验。无论你专注于提示词工程、算法策略，还是 UI/UX、日志回放模块，都可以通过 Pull Request 与 Issue 分享你的想法。',
          '平台欢迎所有遵循 MIT License 的贡献者加入。提交代码时记得注明所使用的 AI 工具或模型，如果需要帮助，可通过 GitHub Issue 或邮箱 ai-gaming.online@outlook.com 联系维护者。',
        ],
        tags: ['社区', '贡献指南'],
      },
    ],
  },
  en: {
    title: 'AI Battle Platform Blog',
    intro: [
      'Welcome to the AI Battle Platform development blog. This space highlights our product vision, release milestones, and experiments around competitive AI gameplay.',
    ],
    posts: [
      {
        id: 'vision-and-roadmap',
        title: 'Vision & Roadmap Highlights',
        date: '2025-10-01',
        paragraphs: [
          'AI Battle Platform (ai-gaming.online) keeps expanding support for Fight the Landlord competitive AI scene. Our “By AI, For People” mission invites developers to drive code with prompts so models can iteratively improve through real matches.',
          'Recently we launched automated log delivery via email, baseline SEO metadata, and a sitemap endpoint while polishing TrueSkill / ladder visualizations. Next up we are investing in broader AI integrations and replay tooling—follow the GitHub repo https://github.com/woshisimox/Fight-the-Landlord and join the conversation.',
        ],
        tags: ['vision', 'roadmap', 'release'],
      },
      {
        id: 'community-call',
        title: 'Community Call for Contributors',
        date: '2025-10-07',
        paragraphs: [
          'We are onboarding more developers and researchers to elevate the AI match experience for Fight the Landlord. Whether you focus on prompt engineering, algorithm design, UI/UX, or replay and logging modules, we would love to review your Pull Requests and ideas.',
          'Contributions are welcome under the MIT License. Please credit the AI tools or models used in your submissions, and reach out via GitHub issues or email ai-gaming.online@outlook.com if you need support.',
        ],
        tags: ['community', 'contribution'],
      },
    ],
  },
};

const DISCORD_INVITE_EMAIL = 'ai-gaming.online@outlook.com';
const DISCORD_FALLBACK_MAIL_SUBJECT = encodeURIComponent('Discord Invite Request');
const DISCORD_FALLBACK_MAIL_URL = `mailto:${DISCORD_INVITE_EMAIL}?subject=${DISCORD_FALLBACK_MAIL_SUBJECT}`;
const DEFAULT_DISCORD_INVITE_URL = 'https://discord.gg/DCjqVfhk';
const DISCORD_DIRECT_INVITE_URL = (
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? DEFAULT_DISCORD_INVITE_URL
).trim();
const HAS_DIRECT_DISCORD_INVITE = DISCORD_DIRECT_INVITE_URL.length > 0;
const RESOLVED_DISCORD_INVITE_URL = HAS_DIRECT_DISCORD_INVITE
  ? DISCORD_DIRECT_INVITE_URL
  : DISCORD_FALLBACK_MAIL_URL;

const DISCORD_CONTENT: Record<Lang, DiscordContent> = {
  zh: {
    title: 'Discord 实时社区',
    intro: [
      'ai-gaming.online 的 Discord 服务器汇集了开发者、AI 选手与平台维护者，是托管赛程规划、训练日志与实时公告的核心阵地。',
      '加入后即可第一时间获得平台更新、玩法讨论以及 Prompt 协作案例，参与社区驱动的 AI 竞技生态建设。',
    ],
    serverName: 'ai-gaming.online Discord Server',
    inviteText: HAS_DIRECT_DISCORD_INVITE
      ? `立即加入服务器： ${RESOLVED_DISCORD_INVITE_URL}`
      : `点击下方按钮邮件联系 ${DISCORD_INVITE_EMAIL} 获取最新的 Discord 邀请链接。`,
    inviteUrl: RESOLVED_DISCORD_INVITE_URL,
    inviteNote: HAS_DIRECT_DISCORD_INVITE
      ? `提示：如遇到链接失效，可通过邮箱 ${DISCORD_INVITE_EMAIL} 获取最新邀请。`
      : '提示：当前公开邀请链接暂不可用，我们会尽快更新。发送邮件后即可收到最新加入方式。',
    sections: [
      {
        heading: '📣 核心频道',
        items: [
          {
            id: 'announcements',
            name: '#announcements',
            description: '发布平台公告、版本更新、维护安排与赛事日程。',
          },
          {
            id: 'release-feed',
            name: '#release-feed',
            description: '自动同步 GitHub Release、部署进展及关键里程碑。',
          },
          {
            id: 'match-log',
            name: '#match-log',
            description: '备份重点赛事的运行日志与赛果，便于回溯与分析。',
          },
        ],
      },
      {
        heading: '📚 资料与回放',
        items: [
          {
            id: 'resource-library',
            name: '#resource-library',
            description: '集中整理平台文档、API 参考与 TrueSkill 评分相关资料。',
          },
          {
            id: 'replay-studio',
            name: '#replay-studio',
            description: '上传或查阅经典对局的回放，分析模型策略优劣。',
          },
        ],
      },
    ],
    footer: [
      '社区遵循 MIT License 精神，欢迎在频道内分享 AI 相关研究、插件与可复现案例。',
      '请遵守服务器规则，尊重每位参与者，并保持技术讨论的专业与友好。',
    ],
  },
  en: {
    title: 'Discord Community Hub',
    intro: [
      'The ai-gaming.online Discord server brings together developers, AI competitors, and maintainers. It hosts our schedules, training logs, and real-time announcements.',
      'Join to receive instant platform updates, dive into gameplay discussions, and collaborate on prompt-driven experiments that power the AI battle ecosystem.',
    ],
    serverName: 'ai-gaming.online Discord Server',
    inviteText: HAS_DIRECT_DISCORD_INVITE
      ? `Join the server now: ${RESOLVED_DISCORD_INVITE_URL}`
      : `Tap the button below to email ${DISCORD_INVITE_EMAIL} for the latest Discord invite link.`,
    inviteUrl: RESOLVED_DISCORD_INVITE_URL,
    inviteNote: HAS_DIRECT_DISCORD_INVITE
      ? `Tip: If the invite expires, reach out via ${DISCORD_INVITE_EMAIL} for the latest link.`
      : `Tip: The public invite is currently offline. Email ${DISCORD_INVITE_EMAIL} and we will share the most recent access link shortly.`,
    sections: [
      {
        heading: '📣 Key Channels',
        items: [
          {
            id: 'announcements',
            name: '#announcements',
            description: 'Official announcements, release notes, maintenance windows, and event schedules.',
          },
          {
            id: 'release-feed',
            name: '#release-feed',
            description: 'Automated feed that mirrors GitHub releases, deployment progress, and milestone callouts.',
          },
          {
            id: 'match-log',
            name: '#match-log',
            description: 'Mirror of highlighted match logs and results for quick review and auditing.',
          },
        ],
      },
      {
        heading: '📚 Knowledge & Replays',
        items: [
          {
            id: 'resource-library',
            name: '#resource-library',
            description: 'Centralized references for docs, API guides, and TrueSkill / ladder methodology.',
          },
          {
            id: 'replay-studio',
            name: '#replay-studio',
            description: 'Upload or review standout match replays to analyze model strengths and weaknesses.',
          },
        ],
      },
    ],
    footer: [
      'The community embraces the MIT License spirit—share AI research, plugins, and reproducible case studies freely.',
      'Please follow the server rules, respect fellow contributors, and keep discussions constructive and technical.',
    ],
  },
};

let cachedCreatePortal: ((children: ReactNode, container: Element | DocumentFragment) => ReactNode) | null = null;
const renderViaPortal = (children: ReactNode, container: HTMLElement | null): ReactNode => {
  if (!container) return null;
  if (typeof window === 'undefined') return children;
  if (!cachedCreatePortal) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-dom');
      const fn = mod?.createPortal;
      if (typeof fn === 'function') {
        cachedCreatePortal = fn;
      }
    } catch {
      cachedCreatePortal = null;
    }
  }
  if (cachedCreatePortal) {
    return cachedCreatePortal(children, container);
  }
  return children;
};

function translateTextLiteral(s: string): string {
  let out = s;
  for (const r of TRANSLATIONS) {
    if (typeof r.zh === 'string') {
      if (out === r.zh) out = r.en;
    } else {
      out = out.replace(r.zh, r.en);
    }
  }
  return out;
}

const developerLinkStyle: CSSProperties = { color:'#2563eb', textDecoration:'underline', wordBreak:'break-all' };

function renderRichText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkRegex = /(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[\w.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    const value = match[0];
    if (value.includes('@') && !value.startsWith('http')) {
      nodes.push(
        <a key={`mail-${value}-${index}`} href={`mailto:${value}`} style={developerLinkStyle}>
          {value}
        </a>,
      );
    } else {
      nodes.push(
        <a key={`link-${value}-${index}`} href={value} target="_blank" rel="noreferrer" style={developerLinkStyle}>
          {value}
        </a>,
      );
    }
    lastIndex = linkRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function autoTranslateContainer(root: HTMLElement | null, lang: Lang) {
  if (!root) return;
  const tags = new Set(['BUTTON','LABEL','DIV','SPAN','P','H1','H2','H3','H4','H5','H6','TD','TH','A','LI','STRONG','EM','SMALL','CODE','OPTION']);
  const accept = (node: any) => {
    const el = node.parentElement as HTMLElement | null;
    if (!el) return NodeFilter.FILTER_REJECT;
    if (!tags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
    if (el.closest('[data-i18n-ignore]')) return NodeFilter.FILTER_REJECT;
    const txt = String(node.nodeValue || '').trim();
      if (!txt || !/[\u4e00-\u9fff]/.test(txt)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  };
  const apply = (scope: HTMLElement) => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: accept } as any);
    let n: any;
    while ((n = walker.nextNode())) {
      const textNode = n as Text;
      const el = textNode.parentElement as HTMLElement | null;
      if (!el) continue;
      if (lang === 'zh') {
        const orig = el.getAttribute('data-i18n-orig');
        if (orig != null) textNode.nodeValue = orig;
      } else {
        if (!el.hasAttribute('data-i18n-orig')) el.setAttribute('data-i18n-orig', textNode.nodeValue || '');
      const v = textNode.nodeValue || '';
      if (/[\u4e00-\u9fff]/.test(v)) textNode.nodeValue = translateTextLiteral(v);
      if (el) el.setAttribute('data-i18n-en', textNode.nodeValue || '');
}
    }
  };
  // initial pass
  apply(root);
  // observe dynamic updates once
  if (typeof MutationObserver !== 'undefined' && !root.hasAttribute('data-i18n-observed')) {
    let i18nBatchQueue = new Set<HTMLElement>();
    let i18nBatchScheduled = false;
    const i18nSchedule = () => { if (i18nBatchScheduled) return; i18nBatchScheduled = true; requestAnimationFrame(() => { i18nBatchScheduled = false; i18nBatchQueue.forEach(n=>{ try { apply(n); } catch {} }); i18nBatchQueue.clear(); }); };
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          (m.addedNodes || []).forEach((node: any) => { if (node && node.nodeType === 1) { i18nBatchQueue.add(node as HTMLElement); i18nSchedule(); } });
        } else if (m.type === 'characterData' && m.target && (m.target as any).parentElement) {
          i18nBatchQueue.add((m.target as any).parentElement as HTMLElement); i18nSchedule();
}


// --- i18n click-compat shim ---
// Ensures buttons translated to English still work if code checks Chinese text at click time.
if (typeof document !== 'undefined' && !document.body.hasAttribute('data-i18n-click-swapper')) {
  document.addEventListener('click', (ev) => {
    try {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const el = (target.closest('button, [role="button"], .btn, .Button') as HTMLElement) || null;
      if (!el) return;
      if (document.documentElement.lang !== 'en') return;
      const zh = el.getAttribute('data-i18n-orig');
      const en = el.getAttribute('data-i18n-en');
      const current = (el.textContent || '').trim();
      if (zh && en && current === en.trim()) {
        el.textContent = zh;
        setTimeout(() => { try { if (el.isConnected) el.textContent = en; } catch {} }, 0);
      }
    } catch {}
  }, true); // capture phase, before app handlers
  document.body.setAttribute('data-i18n-click-swapper', '1');
}

      }
    });
    obs.observe(root, { childList: true, characterData: true, subtree: true });
    root.setAttribute('data-i18n-observed', '1');
  }
}


type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'built-in:advanced-hybrid'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http'
  | 'human';

/* ========= TrueSkill（前端轻量实现，1v2：地主 vs 两农民） ========= */
type Rating = { mu:number; sigma:number };
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
const TS_TAU  = 25/300;
const SQRT2 = Math.sqrt(2);
function erf(x:number){ const s=Math.sign(x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return s*y; }
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }
function tsUpdateTwoTeams(r:Rating[], teamA:number[], teamB:number[]){
  const varA = teamA.reduce((s,i)=>s+r[i].sigma**2,0), varB = teamB.reduce((s,i)=>s+r[i].sigma**2,0);
  const muA  = teamA.reduce((s,i)=>s+r[i].mu,0),     muB  = teamB.reduce((s,i)=>s+r[i].mu,0);
  const c2   = varA + varB + 2*TS_BETA*TS_BETA;
  const c    = Math.sqrt(c2);
  const t    = (muA - muB) / c;
  const v = V_exceeds(t), w = W_exceeds(t);
  for (const i of teamA) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu += mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
  for (const i of teamB) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu -= mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
}

const KO_BYE = '__KO_BYE__';
type KnockoutPlayer = string | null;
type KnockoutMatch = { id: string; players: KnockoutPlayer[]; eliminated: KnockoutPlayer | null; };
type KnockoutRound = { matches: KnockoutMatch[] };
type KnockoutFinalStandings = { placements: { token: KnockoutPlayer; total: number }[] };

type KnockoutMatchContext = {
  roundIdx: number;
  matchIdx: number;
  tokens: string[];
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: BotCredentials[];
  delays: number[];
  timeouts: number[];
  labels: string[];
};
type BotCredentials = {
  openai?: string;
  gemini?: string;
  grok?: string;
  kimi?: string;
  qwen?: string;
  deepseek?: string;
  httpBase?: string;
  httpToken?: string;
};
type KnockoutEntry = {
  id: string;
  choice: BotChoice;
  name: string;
  model: string;
  keys: BotCredentials;
  delayMs: number;
  timeoutSecs: number;
};

type KnockoutSettings = {
  enabled: boolean;
  roundsPerGroup: number;
  startScore: number;
  bid: boolean;
  four2: Four2Policy;
  farmerCoop: boolean;
};

const KO_ENTRY_STORAGE = 'ddz_knockout_entries';
const KO_SETTINGS_STORAGE = 'ddz_knockout_settings';
const KO_DEFAULT_DELAY = 1000;
const KO_DEFAULT_TIMEOUT = 30;
const KO_DEFAULT_CHOICES: BotChoice[] = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'built-in:mininet',
  'built-in:advanced-hybrid',
];
const KO_ALL_CHOICES: BotChoice[] = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'built-in:mininet',
  'built-in:ally-support',
  'built-in:endgame-rush',
  'built-in:advanced-hybrid',
  'ai:openai',
  'ai:gemini',
  'ai:grok',
  'ai:kimi',
  'ai:qwen',
  'ai:deepseek',
  'http',
  'human',
];

const KO_DEFAULT_SETTINGS: KnockoutSettings = {
  enabled: true,
  roundsPerGroup: 10,
  startScore: 100,
  bid: true,
  four2: 'both',
  farmerCoop: true,
};

function defaultKnockoutSettings(): KnockoutSettings {
  return { ...KO_DEFAULT_SETTINGS };
}

function sanitizeKnockoutSettings(raw: any): KnockoutSettings {
  const base = typeof raw === 'object' && raw ? raw : {};
  const next = defaultKnockoutSettings();
  if (typeof base.enabled === 'boolean') next.enabled = base.enabled;
  const rounds = Math.max(1, Math.floor(Number(base.roundsPerGroup) || 0));
  if (Number.isFinite(rounds) && rounds > 0) next.roundsPerGroup = rounds;
  const start = Number(base.startScore);
  if (Number.isFinite(start)) next.startScore = start;
  if (typeof base.bid === 'boolean') next.bid = base.bid;
  if (typeof base.farmerCoop === 'boolean') next.farmerCoop = base.farmerCoop;
  if (base.four2 === 'both' || base.four2 === '2singles' || base.four2 === '2pairs') {
    next.four2 = base.four2;
  }
  return next;
}

function makeKnockoutEntryId() {
  return `ko-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function defaultAliasForChoice(choice: BotChoice, existing: KnockoutEntry[]): string {
  const base = choiceLabel(choice);
  const taken = new Set(existing.map(e => e.name.trim()));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} #${suffix}`)) suffix += 1;
  return `${base} #${suffix}`;
}

function deriveAutoAliasSuffix(alias: string, choice: BotChoice): string | undefined {
  const base = choiceLabel(choice);
  const trimmed = alias.trim();
  if (!trimmed) return '';
  if (trimmed === base) return '';
  const prefix = `${base} #`;
  if (trimmed.startsWith(prefix)) {
    const rest = trimmed.slice(prefix.length);
    if (/^\d+$/.test(rest)) return ` #${rest}`;
  }
  return undefined;
}

function createDefaultKnockoutEntry(choice: BotChoice, existing: KnockoutEntry[]): KnockoutEntry {
  return {
    id: makeKnockoutEntryId(),
    choice,
    name: defaultAliasForChoice(choice, existing),
    model: '',
    keys: {},
    delayMs: KO_DEFAULT_DELAY,
    timeoutSecs: KO_DEFAULT_TIMEOUT,
  };
}

function makeDefaultKnockoutEntries(): KnockoutEntry[] {
  const entries: KnockoutEntry[] = [];
  for (const choice of KO_DEFAULT_CHOICES) {
    entries.push(createDefaultKnockoutEntry(choice, entries));
  }
  return entries;
}

function sanitizeKnockoutKeys(choice: BotChoice, raw: any): BotCredentials {
  const base: BotCredentials = typeof raw === 'object' && raw ? raw : {};
  const out: BotCredentials = {};
  if (typeof base.openai === 'string') out.openai = base.openai;
  if (typeof base.gemini === 'string') out.gemini = base.gemini;
  if (typeof base.grok === 'string') out.grok = base.grok;
  if (typeof base.kimi === 'string') out.kimi = base.kimi;
  if (typeof base.qwen === 'string') out.qwen = base.qwen;
  if (typeof base.deepseek === 'string') out.deepseek = base.deepseek;
  if (typeof base.httpBase === 'string') out.httpBase = base.httpBase;
  if (typeof base.httpToken === 'string') out.httpToken = base.httpToken;
  if (choice === 'http') {
    if (out.httpBase === undefined) out.httpBase = '';
    if (out.httpToken === undefined) out.httpToken = '';
  }
  return out;
}

function reviveStoredKnockoutKeys(choice: BotChoice, raw: any): BotCredentials {
  if (choice === 'http') {
    const base = typeof raw?.httpBase === 'string' ? raw.httpBase : '';
    return base ? { httpBase: base } : {};
  }
  return {};
}

function persistableKnockoutEntry(entry: KnockoutEntry) {
  const { keys, ...rest } = entry;
  if (entry.choice === 'http') {
    const base = typeof keys?.httpBase === 'string' ? keys.httpBase.trim() : '';
    const safe: BotCredentials = {};
    if (base) safe.httpBase = base;
    if (Object.keys(safe).length) return { ...rest, keys: safe };
    return rest;
  }
  return rest;
}

function normalizeKnockoutEntries(raw: any): KnockoutEntry[] {
  if (!Array.isArray(raw)) return makeDefaultKnockoutEntries();
  const entries: KnockoutEntry[] = [];
  for (const item of raw) {
    const choice = KO_ALL_CHOICES.includes(item?.choice) ? (item.choice as BotChoice) : 'built-in:greedy-max';
    const name = typeof item?.name === 'string' && item.name.trim()
      ? item.name.trim()
      : defaultAliasForChoice(choice, entries);
    const id = typeof item?.id === 'string' && item.id
      ? item.id
      : makeKnockoutEntryId();
    const model = choice.startsWith('ai:') && typeof item?.model === 'string'
      ? item.model
      : '';
    const keys = reviveStoredKnockoutKeys(choice, item?.keys);
    const delayMs = Number.isFinite(Number(item?.delayMs)) ? Math.max(0, Math.floor(Number(item.delayMs))) : KO_DEFAULT_DELAY;
    const timeoutSecs = Number.isFinite(Number(item?.timeoutSecs))
      ? Math.max(5, Math.floor(Number(item.timeoutSecs)))
      : KO_DEFAULT_TIMEOUT;
    entries.push({ id, choice, name, model, keys, delayMs, timeoutSecs });
  }
  if (entries.length < 2) return makeDefaultKnockoutEntries();
  return entries;
}

function cloneKnockoutRounds(rounds: KnockoutRound[]): KnockoutRound[] {
  return rounds
    .map((round, ridx) => ({
      matches: (round?.matches || [])
        .map((match, midx) => {
          const rawPlayers = Array.isArray(match?.players) ? match.players : [];
          const players = rawPlayers
            .filter((p, idx) => idx < 3 && typeof p === 'string' && p)
            .map(p => (p === KO_BYE ? KO_BYE : (p as KnockoutPlayer)));
          if (!players.length) return null;
          const eliminated = typeof match?.eliminated === 'string' && players.includes(match.eliminated as KnockoutPlayer)
            ? match.eliminated
            : typeof (match as any)?.winner === 'string' && players.includes((match as any).winner as KnockoutPlayer)
              ? (match as any).winner
              : null;
          return {
            id: typeof match?.id === 'string' && match.id ? match.id : `R${ridx}-M${midx}`,
            players: players as KnockoutPlayer[],
            eliminated,
          };
        })
        .filter((match): match is KnockoutMatch => !!match),
    }))
    .filter(round => round.matches.length);
}

function distributeKnockoutPlayers(pool: KnockoutPlayer[]): KnockoutPlayer[][] {
  const players = pool.filter(p => !!p);
  if (!players.length) return [];
  const padded: KnockoutPlayer[] = [...players];
  while (padded.length % 3 !== 0) {
    padded.push(KO_BYE);
  }
  const groups: KnockoutPlayer[][] = [];
  for (let idx = 0; idx < padded.length; idx += 3) {
    groups.push(padded.slice(idx, idx + 3));
  }
  return groups;
}

function buildMatchesFromPool(
  pool: KnockoutPlayer[],
  roundIdx: number,
  template?: KnockoutRound,
): KnockoutMatch[] {
  const templateMatches = template ? cloneKnockoutRounds([template])[0]?.matches ?? [] : [];
  const groups = distributeKnockoutPlayers(pool);
  return groups.map((players, midx) => {
    const templateMatch = templateMatches[midx];
    const samePlayers =
      templateMatch?.players?.length === players.length &&
      templateMatch.players.every((p, i) => p === players[i]);
    const eliminated = samePlayers && templateMatch?.eliminated && players.includes(templateMatch.eliminated)
      ? templateMatch.eliminated
      : null;
    return {
      id: templateMatch?.id ?? `R${roundIdx}-M${midx}`,
      players,
      eliminated,
    };
  });
}

function isRoundComplete(round: KnockoutRound): boolean {
  return round.matches.every(match => {
    const active = match.players.filter(p => !!p && p !== KO_BYE);
    if (active.length <= 1) return true;
    const hasBye = match.players.some(p => p === KO_BYE);
    if (hasBye && match.eliminated === KO_BYE) return true;
    return !!match.eliminated && active.includes(match.eliminated);
  });
}

function collectSurvivors(round: KnockoutRound): KnockoutPlayer[] {
  const survivors: KnockoutPlayer[] = [];
  for (const match of round.matches) {
    for (const player of match.players) {
      if (player && player !== match.eliminated && player !== KO_BYE) {
        survivors.push(player);
      }
    }
  }
  return survivors;
}

function isFinalRoundStructure(round: KnockoutRound | null | undefined): boolean {
  if (!round || !Array.isArray(round.matches) || round.matches.length !== 1) return false;
  const match = round.matches[0];
  if (!match) return false;
  const active = match.players.filter(p => p && p !== KO_BYE);
  return active.length === 3;
}

function isFinalRoundMatch(rounds: KnockoutRound[], roundIdx: number, matchIdx: number): boolean {
  if (!rounds.length) return false;
  if (roundIdx !== rounds.length - 1) return false;
  const round = rounds[roundIdx];
  if (!isFinalRoundStructure(round)) return false;
  const match = round.matches[matchIdx];
  if (!match) return false;
  const active = match.players.filter(p => p && p !== KO_BYE);
  return active.length === 3;
}

function isSingleTrioTournament(rounds: KnockoutRound[]): boolean {
  if (!Array.isArray(rounds) || rounds.length !== 1) return false;
  const first = rounds[0];
  if (!isFinalRoundStructure(first)) return false;
  const unique = new Set<string>();
  for (const match of first.matches) {
    for (const player of match.players) {
      if (player && player !== KO_BYE) unique.add(player);
    }
  }
  return unique.size > 0 && unique.size <= 3;
}

function shuffleArray<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeKnockoutRounds(base: KnockoutRound[]): KnockoutRound[] {
  const sanitized = cloneKnockoutRounds(base);
  if (!sanitized.length) return [];
  const rounds: KnockoutRound[] = [];
  const first = sanitized[0];
  if (!first.matches.length) return [];
  rounds.push({ matches: first.matches });
  if (!isRoundComplete(first)) return rounds;

  let survivors = collectSurvivors(first);
  let roundIndex = 1;
  while (survivors.length > 1) {
    const template = sanitized[roundIndex];
    const nextMatches = buildMatchesFromPool(survivors, roundIndex, template);
    if (!nextMatches.length) break;
    const nextRound: KnockoutRound = { matches: nextMatches };
    rounds.push(nextRound);
    if (!isRoundComplete(nextRound)) break;
    survivors = collectSurvivors(nextRound);
    roundIndex += 1;
  }
  return rounds;
}

function encodeRoundsSignature(rounds: KnockoutRound[]): string {
  return JSON.stringify(rounds.map(round => ({
    matches: round.matches.map(match => ({
      players: match.players,
      eliminated: match.eliminated ?? null,
    })),
  })));
}

function applyEliminationToDraft(
  draft: KnockoutRound[],
  roundIdx: number,
  matchIdx: number,
  eliminated: KnockoutPlayer | null,
) {
  const match = draft[roundIdx]?.matches?.[matchIdx];
  if (!match) return;
  match.eliminated = eliminated;
  draft.length = roundIdx + 1;
  const current = draft[roundIdx];
  if (!current || !isRoundComplete(current)) return;
  const survivors = collectSurvivors(current);
  if (isFinalRoundStructure(current)) return;
  if (survivors.length <= 1) return;
  const shuffled = shuffleArray(survivors);
  const nextMatches = buildMatchesFromPool(shuffled, roundIdx + 1);
  if (nextMatches.length) {
    draft.push({ matches: nextMatches });
  }
}

function findNextPlayableMatch(rounds: KnockoutRound[]): { roundIdx: number; matchIdx: number } | null {
  for (let ridx = 0; ridx < rounds.length; ridx++) {
    const round = rounds[ridx];
    if (!round?.matches?.length) continue;
    for (let midx = 0; midx < round.matches.length; midx++) {
      const match = round.matches[midx];
      if (!match) continue;
      const active = match.players.filter(p => p && p !== KO_BYE);
      if (active.length >= 3 && !match.eliminated) {
        return { roundIdx: ridx, matchIdx: midx };
      }
      if (active.length < 3 && !match.eliminated) {
        return { roundIdx: ridx, matchIdx: midx };
      }
    }
  }
  return null;
}

/* ===== TrueSkill 本地存档（新增） ===== */
type TsRole = 'landlord'|'farmer';
type TsStoreEntry = {
  id: string;                 // 身份（详见 seatIdentity）
  label?: string;
  overall?: Rating | null;    // 总体
  roles?: {                   // 角色分档
    landlord?: Rating | null;
    farmer?: Rating | null;
  };
  meta?: { choice?: string; model?: string; httpBase?: string };
};
type TsStore = {
  schema: 'ddz-trueskill@1';
  updatedAt: string;
  players: Record<string, TsStoreEntry>;
};
const TS_STORE_KEY = 'ddz_ts_store_v1';

const ensureRating = (x:any): Rating => {
  const mu = Number(x?.mu), sigma = Number(x?.sigma);
  if (Number.isFinite(mu) && Number.isFinite(sigma)) return { mu, sigma };
  return { ...TS_DEFAULT };
};
const emptyStore = (): TsStore => ({ schema:'ddz-trueskill@1', updatedAt:new Date().toISOString(), players:{} });
const readStore = (): TsStore => {
  try { const raw = localStorage.getItem(TS_STORE_KEY); if (!raw) return emptyStore();
    const j = JSON.parse(raw); if (j?.schema && j?.players) return j as TsStore;
  } catch {}
  return emptyStore();
};
const writeStore = (s: TsStore) => { try { s.updatedAt=new Date().toISOString(); localStorage.setItem(TS_STORE_KEY, JSON.stringify(s)); } catch {} };

/* ====== 其它 UI/逻辑 ====== */
type LiveProps = {
  rounds: number;
  startScore: number;
  instanceId: number;

  seatDelayMs?: number[];
  enabled: boolean;
  bid: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
  onRunningChange?: (running: boolean) => void;
  onPauseChange?: (paused: boolean) => void;
  onFinished?: (result: LivePanelFinishPayload) => void;
  controlsHidden?: boolean;
  initialTotals?: [number, number, number] | null;
  turnTimeoutSecs?: number[];
  controlsPortal?: HTMLElement | null;
};

type LivePanelHandle = {
  start: () => Promise<void>;
  stop: () => void;
  togglePause: () => void;
  isRunning: () => boolean;
  isPaused: () => boolean;
  getInstanceId: () => number;
};

type LivePanelFinishPayload = {
  aborted: boolean;
  finishedCount: number;
  totals: [number, number, number];
  completedAll: boolean;
  endedEarlyForNegative?: boolean;
};

type RunLogDeliveryPayload = {
  runId: string;
  mode: 'regular' | 'knockout';
  logLines: string[];
  metadata: Record<string, any>;
};

type RunLogDeliveryResponse = {
  ok: boolean;
  runId?: string;
  delivered?: boolean;
  message?: string;
  error?: string;
};

const LOG_DELIVERY_ENDPOINT = ((process.env.NEXT_PUBLIC_LOG_DELIVERY_ENDPOINT ?? '') as string).trim()
  || '/api/deliver_logs';
const LOG_DELIVERY_MAX_ATTEMPTS = 3;
const LOG_DELIVERY_RETRY_DELAY_MS = 2000;

async function postRunLogDelivery(payload: RunLogDeliveryPayload, attempt = 1): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  try {
    const res = await fetch(LOG_DELIVERY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    const text = await res.text().catch(() => '');
    let data: RunLogDeliveryResponse | null = null;
    if (text) {
      try { data = JSON.parse(text) as RunLogDeliveryResponse; } catch {}
    }
    const delivered = data?.delivered ?? data?.ok;
    if (!res.ok || !delivered) {
      const message = data?.message || data?.error || (text || `HTTP ${res.status}`);
      console.error(`[log-delivery] send failed (attempt ${attempt})`, message);
      if (attempt < LOG_DELIVERY_MAX_ATTEMPTS) {
        setTimeout(() => { void postRunLogDelivery(payload, attempt + 1); }, LOG_DELIVERY_RETRY_DELAY_MS * attempt);
      }
      return;
    }
    console.info('[log-delivery] sent run log', data?.runId || payload.runId);
  } catch (err) {
    console.error(`[log-delivery] request failed (attempt ${attempt})`, err);
    if (attempt < LOG_DELIVERY_MAX_ATTEMPTS) {
      setTimeout(() => { void postRunLogDelivery(payload, attempt + 1); }, LOG_DELIVERY_RETRY_DELAY_MS * attempt);
    }
  }
}

type HumanHint = {
  move: 'play' | 'pass';
  cards?: string[];
  score?: number;
  reason?: string;
  label?: string;
  by?: string;
  valid?: boolean;
  missing?: string[];
};

type HumanPrompt = {
  seat: number;
  requestId: string;
  phase: string;
  ctx: any;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  latencyMs?: number;
  remainingMs?: number;
  delayMs?: number;
  by?: string;
  hint?: HumanHint;
  issuedAt: number;
  expiresAt?: number;
  serverIssuedAt?: number;
  serverExpiresAt?: number;
  stale?: boolean;
};

type BotTimer = {
  seat: number;
  phase: string;
  timeoutMs: number;
  issuedAt: number;
  expiresAt: number;
  provider?: string;
};

function SeatTitle({
  i,
  landlord = false,
  showDetail = true,
  align = 'flex-start',
}: { i:number; landlord?: boolean; showDetail?: boolean; align?: CSSProperties['alignItems'] }) {
  const { lang } = useI18n();
  const details = useContext(SeatInfoContext);
  const label = seatLabel(i, lang);
  const detailRaw = details?.[i];
  const detail = detailRaw && detailRaw.trim() ? detailRaw.trim() : '';
  const landlordLabel = lang === 'en' ? '(Landlord)' : '（地主）';
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:align, lineHeight:1.2 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:700 }}>
        <span>{label}</span>
        {landlord && (
          <span style={{ color:'#bf7f00', fontWeight:600 }}>{landlordLabel}</span>
        )}
      </div>
      {showDetail && detail && (
        <div style={{ fontSize:12, color:'#4b5563', fontWeight:500 }}>{detail}</div>
      )}
    </div>
  );
}


type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const ASCII_SUIT_MAP: Record<string, SuitSym> = {
  S: '♠', s: '♠',
  H: '♥', h: '♥',
  D: '♦', d: '♦',
  C: '♣', c: '♣',
};
const JOKER_ALIAS_MAP: Record<string, 'x' | 'X'> = {
  BJ: 'x',
  SJ: 'x',
  BLACKJOKER: 'x',
  BLACK_JOKER: 'x',
  SMALLJOKER: 'x',
  SMALL_JOKER: 'x',
  'SMALL-JOKER': 'x',
  JOKERX: 'x',
  'JOKER-X': 'x',
  JOKER_X: 'x',
  'JOKER-SMALL': 'x',
  JOKER_SMALL: 'x',
  RJ: 'X',
  LJ: 'X',
  REDJOKER: 'X',
  RED_JOKER: 'X',
  BIGJOKER: 'X',
  BIG_JOKER: 'X',
  'BIG-JOKER': 'X',
  'JOKER-BIG': 'X',
  JOKER_BIG: 'X',
  JOKERY: 'X',
  'JOKER-Y': 'X',
  JOKER_Y: 'X',
  JOKER: 'X',
};

const stripVariantSelectors = (value: string): string => value.replace(/[\u200d\ufe0e\ufe0f]/g, '');
const TEXT_VARIANT_SUITS: Record<SuitSym, string> = {
  '♠': '♠︎',
  '♥': '♥︎',
  '♦': '♦︎',
  '♣': '♣︎',
  '🃏': '🃏',
};
const ensureTextSuitGlyph = (value: string): string => {
  if (!value) return value;
  const cleaned = stripVariantSelectors(value);
  if (cleaned === '🃏') return '🃏';
  if (SUITS.includes(cleaned as SuitSym)) {
    return TEXT_VARIANT_SUITS[cleaned as SuitSym] ?? cleaned;
  }
  return cleaned;
};

const normalizeRankToken = (token: string): string => {
  if (!token) return '';
  const trimmed = stripVariantSelectors(token.trim());
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  const alias = JOKER_ALIAS_MAP[upper];
  if (alias) return alias;
  const lower = trimmed.toLowerCase();
  if (lower === 'x') return 'x';
  if (lower === 'y') return 'X';
  if (lower === 'small') return 'x';
  if (lower === 'big') return 'X';
  if (upper === '10') return 'T';
  return upper;
};
type SuitUsageOwner = string;
type RankSuitUsage = Map<string, Map<string, SuitUsageOwner>>;
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);
type BottomInfo = {
  landlord: number | null;
  cards: { label: string; used: boolean }[];
  revealed: boolean;
};

type DeckOwner = { type: 'seat'; seat: number } | { type: 'bottom'; index: number };
type DeckDuplicate = { key: string; owners: DeckOwner[]; count: number };
type DeckAuditReport = {
  total: number;
  expectedTotal: number;
  perSeat: number[];
  bottom: number;
  duplicates: DeckDuplicate[];
  missing: string[];
  fingerprint: string;
  timestamp: number;
};

const rankOf = (l: string) => {
  if (!l) return '';
  const raw = stripVariantSelectors(String(l).trim());
  if (!raw) return '';
  if (raw === 'x') return 'x';
  if (raw === 'X') return 'X';
  if (raw.startsWith('🃏')) {
    const tail = raw.slice(2).trim();
    if (!tail) return 'X';
    const alias = JOKER_ALIAS_MAP[tail.toUpperCase()];
    if (alias) return alias;
    if (/^[x]$/i.test(tail)) return tail === 'x' ? 'x' : 'X';
    if (/^[y]$/i.test(tail)) return 'X';
    return normalizeRankToken(tail);
  }
  const c0 = raw[0];
  if ('♠♥♦♣'.includes(c0)) return normalizeRankToken(raw.slice(1));
  const asciiSuit = ASCII_SUIT_MAP[c0];
  if (asciiSuit) return normalizeRankToken(raw.slice(1));
  const alias = JOKER_ALIAS_MAP[raw.toUpperCase()];
  if (alias) return alias;
  return normalizeRankToken(raw);
};
const suitOf = (l: string): SuitSym | null => {
  if (!l) return null;
  const cleaned = stripVariantSelectors(l);
  const c0 = cleaned[0];
  if (SUITS.includes(c0 as SuitSym)) return c0 as SuitSym;
  const ascii = ASCII_SUIT_MAP[c0];
  return ascii ?? null;
};
const suitKeyForLabel = (label: string): string | null => {
  if (!label) return null;
  if (label.startsWith('🃏')) return label;
  const alias = JOKER_ALIAS_MAP[stripVariantSelectors(label).trim().toUpperCase()];
  if (alias) return alias === 'x' ? '🃏X' : '🃏Y';
  const suit = suitOf(label);
  return suit ?? null;
};
const snapshotSuitUsage = (usage: RankSuitUsage, excludeOwner?: SuitUsageOwner): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const [rank, entries] of usage.entries()) {
    const set = new Set<string>();
    for (const [suitKey, owner] of entries.entries()) {
      if (excludeOwner && owner === excludeOwner) continue;
      set.add(suitKey);
    }
    if (set.size) out.set(rank, set);
  }
  return out;
};
const cloneReservedMap = (reserved: Map<string, Set<string>>): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  reserved.forEach((set, rank) => {
    out.set(rank, new Set(set));
  });
  return out;
};
const unregisterSuitUsage = (usage: RankSuitUsage, owner: SuitUsageOwner, labels: string[]) => {
  if (!labels?.length) return;
  for (const label of labels) {
    const rank = rankOf(label);
    const key = suitKeyForLabel(label);
    if (!rank || !key) continue;
    const perRank = usage.get(rank);
    if (!perRank) continue;
    if (perRank.get(key) === owner) {
      perRank.delete(key);
      if (perRank.size === 0) usage.delete(rank);
    }
  }
};
const registerSuitUsage = (usage: RankSuitUsage, owner: SuitUsageOwner, labels: string[]) => {
  if (!labels?.length) return;
  for (const label of labels) {
    const rank = rankOf(label);
    const key = suitKeyForLabel(label);
    if (!rank || !key) continue;
    if (!usage.has(rank)) usage.set(rank, new Map());
    usage.get(rank)!.set(key, owner);
  }
};
type SeatSuitPrefs = Array<Map<string, Set<string>> | undefined>;
const extractSeatSuitPrefs = (hand: string[] | undefined): Map<string, Set<string>> | undefined => {
  if (!Array.isArray(hand)) return undefined;
  let map: Map<string, Set<string>> | undefined;
  for (const rawCard of hand) {
    if (rawCard == null) continue;
    const label = displayLabelFromRaw(String(rawCard));
    const rank = rankOf(label);
    const suitKey = suitKeyForLabel(label);
    if (!rank || !suitKey) continue;
    if (!map) map = new Map<string, Set<string>>();
    if (!map.has(rank)) map.set(rank, new Set());
    map.get(rank)!.add(suitKey);
  }
  return map;
};
const extractAllSeatSuitPrefs = (hands: string[][] | undefined): SeatSuitPrefs | null => {
  if (!Array.isArray(hands)) return null;
  const out: SeatSuitPrefs = [];
  hands.forEach((hand, idx) => {
    out[idx] = extractSeatSuitPrefs(hand);
  });
  return out;
};
const mergeReservedWithForeign = (
  base: Map<string, Set<string>>,
  seat: number,
  prefs: SeatSuitPrefs | null,
): Map<string, Set<string>> => {
  if (!prefs || !prefs.length) return base;
  const merged = cloneReservedMap(base);
  prefs.forEach((perSeat, idx) => {
    if (!perSeat || idx === seat) return;
    perSeat.forEach((suits, rank) => {
      if (!merged.has(rank)) merged.set(rank, new Set());
      const target = merged.get(rank)!;
      suits.forEach(suitKey => target.add(suitKey));
    });
  });
  return merged;
};
const ownerKeyForSeat = (seat: number) => `seat-${seat}`;
function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l === 'x') return ['🃏X'];
  if (l === 'X') return ['🃏Y'];
  const cleaned = stripVariantSelectors(String(l));
  {
    const alias = JOKER_ALIAS_MAP[cleaned.trim().toUpperCase()];
    if (alias === 'x') return ['🃏X'];
    if (alias === 'X') return ['🃏Y'];
  }
  if (cleaned.startsWith('🃏')) return [cleaned];
  const r = rankOf(cleaned);
  if ('♠♥♦♣'.includes(cleaned[0])) {
    const suit = cleaned[0] as SuitSym;
    const base = `${suit}${r}`;
    const extras = SUITS.filter(s => s !== suit).map(s => `${s}${r}`);
    return [base, ...extras];
  }
  const asciiSuit = ASCII_SUIT_MAP[cleaned[0]];
  if (asciiSuit) {
    const base = `${asciiSuit}${r}`;
    const extras = SUITS.filter(s => s !== asciiSuit).map(s => `${s}${r}`);
    return [base, ...extras];
  }
  if (r === 'JOKER') return ['🃏Y'];
  return SUITS.map(s => `${s}${r}`);
}
function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map(l => {
    if (!l) return l;
    if (l === 'x') return '🃏X';
    if (l === 'X') return '🃏Y';
    const cleaned = stripVariantSelectors(l);
    if (cleaned.startsWith('🃏')) return cleaned;
    if ('♠♥♦♣'.includes(cleaned[0])) return `${cleaned[0]}${rankOf(cleaned)}`;
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(cleaned)}`;
  });
}

const RANK_ORDER = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const RANK_POS: Record<string, number> = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i])) as Record<string, number>;

function rankKeyForDisplay(label: string): string {
  if (!label) return '';
  if (label.startsWith('🃏')) {
    const tail = label.slice(2).toUpperCase();
    if (tail === 'X') return 'x';
    if (tail === 'Y') return 'X';
    return tail;
  }
  if (label === 'x' || label === 'X') return label;
  const rk = rankOf(label);
  if (rk === 'Y') return 'X';
  return rk;
}

function sortDisplayHand(cards: string[]): string[] {
  return [...cards].sort((a, b) => {
    const va = RANK_POS[rankKeyForDisplay(a)] ?? -1;
    const vb = RANK_POS[rankKeyForDisplay(b)] ?? -1;
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });
}

function displayLabelFromRaw(label: string): string {
  if (!label) return label;
  if (label.startsWith('🃏')) return `🃏${rankOf(label) || label.slice(2)}`;
  if (label === 'x') return '🃏X';
  if (label === 'X') return '🃏Y';
  {
    const alias = JOKER_ALIAS_MAP[stripVariantSelectors(label).trim().toUpperCase()];
    if (alias === 'x') return '🃏X';
    if (alias === 'X') return '🃏Y';
  }
  const suit = suitOf(label);
  if (suit) return `${suit}${rankOf(label)}`;
  const asciiSuit = ASCII_SUIT_MAP[stripVariantSelectors(label)[0]];
  if (asciiSuit) return `${asciiSuit}${rankOf(label)}`;
  return decorateHandCycle([label])[0];
}

function reconcileHandFromRaw(
  raw: string[] | undefined,
  prev: string[],
  reservedByRank?: Map<string, Set<string>>,
  preferredByRank?: Map<string, Set<string>>,
): string[] {
  if (!Array.isArray(raw)) return prev;
  const pool = prev.slice();
  const usedPrev = pool.map(() => false);
  const usedByRank = new Map<string, Set<string>>();
  if (reservedByRank) {
    for (const [rank, suits] of reservedByRank.entries()) {
      usedByRank.set(rank, new Set(suits));
    }
  }
  const markUsed = (label: string) => {
    const key = suitKeyForLabel(label);
    if (!key) return;
    const rank = rankOf(label);
    if (!rank) return;
    if (!usedByRank.has(rank)) usedByRank.set(rank, new Set<string>());
    usedByRank.get(rank)!.add(key);
  };
  const canUse = (label: string) => {
    const key = suitKeyForLabel(label);
    if (!key) return true;
    const rank = rankOf(label);
    const used = usedByRank.get(rank);
    return !(used && used.has(key));
  };
  const isPreferred = (label: string) => {
    if (!preferredByRank) return false;
    const rank = rankOf(label);
    if (!rank) return false;
    const key = suitKeyForLabel(label);
    if (!key) return false;
    const set = preferredByRank.get(rank);
    return !!(set && set.has(key));
  };
  const decorated: string[] = [];

  for (const label of raw) {
    const options = candDecorations(label);
    let chosen: string | null = null;

    for (const opt of options) {
      const idx = pool.findIndex((v, i) => !usedPrev[i] && v === opt && canUse(opt));
      if (idx >= 0) {
        usedPrev[idx] = true;
        chosen = opt;
        break;
      }
    }

    if (!chosen && preferredByRank) {
      const preferredOpt = options.find(opt => isPreferred(opt) && !decorated.includes(opt));
      if (preferredOpt) {
        chosen = preferredOpt;
      }
    }

    if (!chosen) {
      const fallback = options.find(opt => !decorated.includes(opt) && canUse(opt));
      if (fallback) chosen = fallback;
    }

    if (!chosen) {
      const fallback = options.find(opt => canUse(opt));
      if (fallback) chosen = fallback;
    }

    if (!chosen) {
      chosen = displayLabelFromRaw(label);
    }

    decorated.push(chosen);
    markUsed(chosen);
  }

  return sortDisplayHand(decorated);
}

function resolveBottomDecorations(
  raw: string[],
  landlord: number | null,
  hands: string[][],
  reservedByRank?: Map<string, Set<string>>,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seat = (typeof landlord === 'number' && landlord >= 0 && landlord < 3) ? landlord : null;
  const usedByRank = new Map<string, Set<string>>();
  if (reservedByRank) {
    for (const [rank, suits] of reservedByRank.entries()) {
      usedByRank.set(rank, new Set(suits));
    }
  }
  const markUsed = (label: string) => {
    const key = suitKeyForLabel(label);
    if (!key) return;
    const rank = rankOf(label);
    if (!rank) return;
    if (!usedByRank.has(rank)) usedByRank.set(rank, new Set<string>());
    usedByRank.get(rank)!.add(key);
  };
  const canUse = (label: string) => {
    const key = suitKeyForLabel(label);
    if (!key) return true;
    const rank = rankOf(label);
    const used = usedByRank.get(rank);
    return !(used && used.has(key));
  };
  if (seat == null) {
    return raw.map(card => {
      const options = candDecorations(card);
      const chosen = options.find(opt => canUse(opt)) || options[0] || card;
      markUsed(chosen);
      return chosen;
    });
  }
  const pool = [...(hands?.[seat] || [])];
  return raw.map(card => {
    const options = candDecorations(card);
    for (const opt of options) {
      const idx = pool.indexOf(opt);
      if (idx >= 0 && canUse(opt)) {
        pool.splice(idx, 1);
        markUsed(opt);
        return opt;
      }
    }
    const fallback = options.find(opt => canUse(opt));
    if (fallback) {
      markUsed(fallback);
      return fallback;
    }
    const alt = options[0] || card;
    markUsed(alt);
    return alt;
  });
}

const RANKS_FOR_DECK: readonly string[] = ['3','4','5','6','7','8','9','T','J','Q','K','A','2'];
const FULL_DECK_KEYS: readonly string[] = (() => {
  const keys: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS_FOR_DECK) {
      keys.push(`${suit}${rank}`);
    }
  }
  keys.push('JOKER-SMALL', 'JOKER-BIG');
  return keys;
})();

const canonicalDeckKey = (label: string): string => {
  if (!label) return '';
  if (label.startsWith('🃏')) {
    const tail = label.slice(2).toUpperCase();
    return tail === 'Y' ? 'JOKER-BIG' : 'JOKER-SMALL';
  }
  const suit = suitOf(label) ?? '?';
  const rank = rankOf(label);
  return `${suit}${rank}`;
};

const deckKeyDisplay = (key: string): string => {
  if (!key) return key;
  if (key === 'JOKER-BIG') return '🃏Y';
  if (key === 'JOKER-SMALL') return '🃏X';
  const suit = key[0];
  const rank = key.slice(1);
  const displayRank = rank === 'T' ? '10' : rank;
  if ('♠♥♦♣'.includes(suit)) return `${suit}${displayRank}`;
  return displayRank;
};

function computeDeckAuditSnapshot(hands: string[][], bottom: BottomInfo | null): DeckAuditReport | null {
  if (!Array.isArray(hands) || hands.length !== 3) return null;
  if (bottom && bottom.revealed === false) return null;
  const bottomCards = bottom?.cards?.map(c => c.label).filter((label): label is string => !!label) ?? [];
  const landlord = typeof bottom?.landlord === 'number' && bottom.landlord >= 0 && bottom.landlord < 3
    ? bottom.landlord
    : null;

  const mergedHands = hands.map((hand, seat) => {
    const base = Array.isArray(hand) ? [...hand] : [];
    if (landlord != null && seat === landlord && bottomCards.length) {
      const existingCounts = new Map<string, number>();
      for (const label of base) {
        existingCounts.set(label, (existingCounts.get(label) ?? 0) + 1);
      }
      for (const label of bottomCards) {
        const remaining = existingCounts.get(label) ?? 0;
        if (remaining > 0) {
          existingCounts.set(label, remaining - 1);
        } else {
          base.push(label);
        }
      }
    }
    return base;
  });

  const perSeat = mergedHands.map(hand => hand.length);
  const entries: { key: string; owner: DeckOwner }[] = [];
  mergedHands.forEach((hand, seat) => {
    hand.forEach(label => {
      const key = canonicalDeckKey(label);
      if (!key) return;
      entries.push({ key, owner: { type: 'seat', seat } });
    });
  });

  if (landlord == null) {
    bottomCards.forEach((label, index) => {
      const key = canonicalDeckKey(label);
      if (!key) return;
      entries.push({ key, owner: { type: 'bottom', index } });
    });
  }

  if (!entries.length) return null;
  const seen = new Map<string, DeckOwner[]>();
  for (const entry of entries) {
    if (!seen.has(entry.key)) seen.set(entry.key, []);
    seen.get(entry.key)!.push(entry.owner);
  }
  const duplicates = [...seen.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([key, owners]) => ({ key, owners, count: owners.length }));
  const expectedTotal = FULL_DECK_KEYS.length;
  const total = entries.length;
  const missing = FULL_DECK_KEYS.filter(key => !seen.has(key));
  const fingerprint = entries
    .map(entry => `${entry.key}@${entry.owner.type === 'seat' ? `s${entry.owner.seat}` : `b${entry.owner.index}`}`)
    .sort()
    .join('|');
  return {
    total,
    expectedTotal,
    perSeat,
    bottom: bottomCards.length,
    duplicates,
    missing,
    fingerprint,
    timestamp: Date.now(),
  };
}

type CardProps = {
  label: string;
  dimmed?: boolean;
  compact?: boolean;
  interactive?: boolean;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
};

function Card({ label, dimmed = false, compact = false, interactive = false, selected = false, onClick, disabled = false, hidden = false }: CardProps) {
  const dims = compact
    ? { width: 28, height: 44, gap: 2, backSize: 18, suitSize: 16, rankSize: 12, paddingShown: '6px 4px', paddingHidden: '4px' }
    : { width: 38, height: 58, gap: 4, backSize: 24, suitSize: 22, rankSize: 16, paddingShown: '8px 6px', paddingHidden: '6px' };

  let background = '#fff';
  let borderColor = '#ddd';
  let color = '#1f2937';
  let opacity = 1;
  let inner: ReactNode;

  if (hidden) {
    background = selected ? '#bfdbfe' : '#1f2937';
    borderColor = selected ? '#2563eb' : '#111827';
    color = '#f9fafb';
    inner = <span style={{ fontSize: dims.backSize, lineHeight: 1 }}>🂠</span>;
  } else {
    const normalized = stripVariantSelectors(String(label ?? ''));
    const baseLabel = normalized || String(label ?? '');
    const isJoker = baseLabel.startsWith('🃏');
    const suit = isJoker ? '🃏' : (suitOf(baseLabel) ?? (baseLabel.charAt(0) || ''));
    const rawRank = isJoker ? baseLabel.slice(2) : baseLabel.slice(suit ? 1 : 0);
    const computedRank = rankOf(baseLabel);
    const rankToken = rawRank || computedRank || '';
    const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : '#1a1a1a';
    const rankColor = suit === '🃏' ? (rankToken === 'Y' ? '#d11' : '#16a34a') : undefined;
    const suitColor = dimmed ? '#9ca3af' : baseColor;
    const rankStyle = dimmed
      ? { color: '#9ca3af' }
      : (rankColor ? { color: rankColor } : {});
    const displayRank = rankToken === 'T' ? '10' : rankToken;
    const displaySuit = ensureTextSuitGlyph(suit);
    const suitStyle: React.CSSProperties = {
      fontSize: dims.suitSize,
      lineHeight: 1,
    };
    background = selected ? '#dbeafe' : (dimmed ? '#f3f4f6' : '#fff');
    borderColor = selected ? '#2563eb' : (dimmed ? '#d1d5db' : '#ddd');
    color = suitColor;
    opacity = dimmed ? 0.65 : 1;
    inner = (
      <>
        <span style={suitStyle}>{displaySuit}</span>
        <span style={{ fontSize: dims.rankSize, lineHeight: 1, ...rankStyle }}>{displayRank}</span>
      </>
    );
  }

  const style: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: hidden ? 0 : dims.gap,
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 8,
    padding: hidden ? dims.paddingHidden : dims.paddingShown,
    marginRight: compact ? 4 : 6,
    marginBottom: compact ? 4 : 6,
    fontWeight: 800,
    cursor: interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default',
    outline: selected ? '2px solid #2563eb' : 'none',
    userSelect: 'none',
    width: dims.width,
    minWidth: dims.width,
    height: dims.height,
    boxSizing: 'border-box',
    background,
    borderColor,
    color,
    opacity,
  };

  if (interactive) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={style}
        title={hidden ? label : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <span style={style} title={hidden ? label : undefined}>
      {inner}
    </span>
  );
}
type HandProps = {
  cards: string[];
  interactive?: boolean;
  selectedIndices?: Set<number>;
  onToggle?: (index: number) => void;
  disabled?: boolean;
  faceDown?: boolean;
};

function Hand({ cards, interactive = false, selectedIndices, onToggle, disabled = false, faceDown = false }: HandProps) {
  const { t } = useI18n();
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>{t('Empty')}</span>;
  const selected = selectedIndices ?? new Set<number>();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, idx) => (
        <Card
          key={`${c}-${idx}`}
          label={c}
          interactive={interactive}
          selected={selected.has(idx)}
          onClick={interactive && onToggle ? () => onToggle(idx) : undefined}
          disabled={disabled}
          hidden={faceDown && !interactive}
        />
      ))}
    </div>
  );
}
function PlayRow({ seat, move, cards, reason, showReason = true }:{ seat:number; move:'play'|'pass'; cards?:string[]; reason?:string; showReason?:boolean }) {
  const { t, lang } = useI18n();
  const details = useContext(SeatInfoContext);
  const detailRaw = details?.[seat];
  const detail = detailRaw && detailRaw.trim() ? detailRaw.trim() : '';
  const labelWidth = detail ? 120 : 40;

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:labelWidth, textAlign:'right', opacity:0.9, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
        <span style={{ fontWeight:700 }}>{seatLabel(seat, lang)}</span>
        {detail && <span style={{ fontSize:11, color:'#4b5563', fontWeight:500 }}>{detail}</span>}
      </div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? t('Pass') : t('Play')}</div>
      <div style={{ flex:1 }}>
        {move === 'pass' ? <span style={{ opacity:0.6 }}>过</span> : <Hand cards={cards || []} />}
      </div>
      {showReason && reason && <div style={{ width:260, fontSize:12, color:'#666' }}>{reason}</div>}
    </div>
  );
}
function LogLine({ text }: { text:string }) {
  return (
    <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontSize:12, color:'#555', padding:'2px 0' }}>
      {text}
    </div>
  );
}

/* ===== 思考耗时（thoughtMs）累计均值存档 ===== */
type ThoughtPlayerStats = { mean:number; count:number; label?:string };
type ThoughtStore = { schema:'ddz-latency@3'; updatedAt:string; players:Record<string, ThoughtPlayerStats> };
const THOUGHT_KEY = 'ddz_latency_store_v1';
const THOUGHT_EMPTY: ThoughtStore = { schema:'ddz-latency@3', updatedAt:new Date().toISOString(), players:{} };

const ensurePlayerStats = (raw:any): ThoughtPlayerStats => {
  const meanRaw = Number(raw?.mean);
  const countRaw = Number(raw?.count);
  const labelRaw = typeof raw?.label === 'string' ? raw.label : undefined;
  const label = labelRaw ? labelRaw.slice(0, 160) : undefined;
  return {
    mean: Number.isFinite(meanRaw) ? meanRaw : 0,
    count: Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : 0,
    ...(label ? { label } : {}),
  };
};

function ensureThoughtStore(raw: any): ThoughtStore {
  const updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
  if (raw?.schema === 'ddz-latency@3' && raw?.players && typeof raw.players === 'object') {
    const players: Record<string, ThoughtPlayerStats> = {};
    for (const key of Object.keys(raw.players)) {
      players[key] = ensurePlayerStats(raw.players[key]);
    }
    return { schema:'ddz-latency@3', updatedAt, players };
  }
  // 旧版（按座位）数据无法映射至具体身份，避免误导直接清空
  return { schema:'ddz-latency@3', updatedAt, players:{} };
}

function readThoughtStore(): ThoughtStore {
  if (typeof window === 'undefined') {
    return { ...THOUGHT_EMPTY, updatedAt: new Date().toISOString(), players:{} };
  }
  try {
    const raw = localStorage.getItem(THOUGHT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return ensureThoughtStore(parsed);
    }
  } catch {}
  return { ...THOUGHT_EMPTY, updatedAt: new Date().toISOString(), players:{} };
}

function writeThoughtStore(store: ThoughtStore): ThoughtStore {
  const base: ThoughtStore = ensureThoughtStore(store);
  if (typeof window === 'undefined') return { ...base, updatedAt: new Date().toISOString() };
  const next = { ...base, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(THOUGHT_KEY, JSON.stringify(next)); } catch {}
  return next;
}

const THOUGHT_CATALOG_CHOICES: BotChoice[] = [
  'built-in:greedy-max','built-in:greedy-min','built-in:random-legal','built-in:mininet','built-in:ally-support','built-in:endgame-rush','built-in:advanced-hybrid',
  'ai:openai','ai:gemini','ai:grok','ai:kimi','ai:qwen','ai:deepseek','http','human',
];
const DEFAULT_THOUGHT_CATALOG_IDS = THOUGHT_CATALOG_CHOICES.map(choice => makeThoughtIdentity(choice));

function makeThoughtIdentity(choice: BotChoice, model?: string, base?: string): string {
  const normalizedModel = (model ?? defaultModelFor(choice) ?? '').trim();
  const normalizedBase = choice === 'http' ? (base ?? '').trim() : '';
  return `${choice}|${normalizedModel}|${normalizedBase}`;
}

function parseThoughtIdentity(id: string): { choice: BotChoice | string; model: string; base: string } {
  const [choiceRaw, modelRaw = '', baseRaw = ''] = String(id || '').split('|');
  return { choice: choiceRaw as BotChoice | string, model: modelRaw || '', base: baseRaw || '' };
}

function thoughtLabelForIdentity(id: string): string {
  const { choice, model, base } = parseThoughtIdentity(id);
  const label = choiceLabel(choice as BotChoice);
  if (typeof choice === 'string' && choice.startsWith('ai:')) {
    const fallbackModel = defaultModelFor(choice as BotChoice);
    const displayModel = model || fallbackModel || '';
    return displayModel ? `${label}:${displayModel}` : label;
  }
  if (choice === 'http') {
    const trimmed = (base || '').trim();
    return trimmed ? `${label}:${trimmed}` : label;
  }
  return label;
}

/* ===== 天梯图组件（x=ΔR_event，y=各 AI/内置；含未参赛=历史或0） ===== */
function LadderPanel() {
  const { t, lang } = useI18n();
  const [tick, setTick] = useState(0);
  useEffect(()=>{
    const onAny = () => setTick(k=>k+1);
    if (typeof window !== 'undefined') {
      window.addEventListener('ddz-all-refresh', onAny as any);
    }
    const t = setInterval(onAny, 2000);
    return ()=> { if (typeof window!=='undefined') window.removeEventListener('ddz-all-refresh', onAny as any); clearInterval(t); };
  }, []);

  let store:any = { players:{} };
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('ddz_ladder_store_v1');
      if (raw) store = JSON.parse(raw) || { players:{} };
    }
  } catch {}

  const catalogIds = DEFAULT_THOUGHT_CATALOG_IDS;
  const catalogLabels = (id:string)=> thoughtLabelForIdentity(id);

  const players: Record<string, any> = (store?.players)||{};
  const keys = Array.from(new Set([...Object.keys(players), ...catalogIds]));
  const arr = keys.map((id)=>{
    const ent = players[id];
    const val = ent?.current?.deltaR ?? 0;
    const n   = ent?.current?.n ?? 0;
    const label = ent?.label || catalogLabels(id) || id;
    const rawMatches = ent?.current?.matches;
    const fallbackMatches = ent?.current?.n;
    const matches = (() => {
      const direct = Number(rawMatches);
      if (Number.isFinite(direct)) return Math.max(0, direct);
      const approx = Number(fallbackMatches);
      if (Number.isFinite(approx)) return Math.max(0, Math.round(approx));
      return 0;
    })();
    return { id, label, val, n, matches };
  });

  const valsForRange = (arr.some(x=> x.n>0) ? arr.filter(x=> x.n>0) : arr);
  const minVal = Math.min(0, ...valsForRange.map(x=> x.val));
  const maxVal = Math.max(0, ...valsForRange.map(x=> x.val));
  const maxAbs = Math.max(Math.abs(minVal), Math.abs(maxVal));
  const K = Math.max(1, maxAbs * 1.1);

  const itemsByScore = [...arr].sort((a,b)=> b.val - a.val);
  const itemsByPlays = [...arr].sort((a,b)=> b.matches - a.matches);
  const maxPlays = itemsByPlays.reduce((m, it) => Math.max(m, it.matches || 0), 0);

  const axisStyle:any = { position:'absolute', left:'50%', top:0, bottom:0, width:1, background:'#e5e7eb' };
  const playsUnit = lang === 'en' ? 'games' : '局';

  return (
    <div style={{ border:'1px dashed #e5e7eb', borderRadius:8, padding:10, marginTop:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontWeight:700 }}>{t('LadderTitle')}</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {`${t('LadderSubtitle')} · ${t('LadderRange', { K })}`}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr 56px', gap:8 }}>
        {itemsByScore.map((it:any)=>{
          const pct = Math.min(1, Math.abs(it.val)/K);
          const pos = it.val >= 0;
          return (
            <div key={it.id} style={{ display:'contents' }}>
              <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.label}</div>
              <div style={{ position:'relative', height:16, background:'#f9fafb', border:'1px solid #f3f4f6', borderRadius:8 }}>
                <div style={axisStyle} />
                <div style={{ position:'absolute', left: pos ? '50%' : `${50 - pct*50}%`, width: `${pct*50}%`, top:2, bottom:2, background: pos ? '#16a34a' : '#ef4444', borderRadius:6 }}/>
              </div>
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', textAlign:'right' }}>{it.val.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontWeight:700, marginTop:16 }}>{t('LadderPlaysTitle')}</div>
      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr 96px', gap:8, marginTop:6 }}>
        {itemsByPlays.map((it:any)=>{
          const pct = maxPlays > 0 ? Math.min(1, (it.matches || 0) / maxPlays) : 0;
          const countText = (() => {
            const count = typeof it.matches === 'number' && isFinite(it.matches) ? it.matches : 0;
            const rounded = Math.round(count);
            const formatted = rounded > 0 ? rounded.toLocaleString() : '0';
            return `${formatted} ${playsUnit}`;
          })();
          return (
            <div key={`plays-${it.id}`} style={{ display:'contents' }}>
              <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.label}</div>
              <div style={{ position:'relative', height:16, background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8 }}>
                <div style={{ position:'absolute', left:0, top:2, bottom:2, width:`${pct*100}%`, background:'#2563eb', borderRadius:6 }} />
              </div>
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', textAlign:'right', whiteSpace:'nowrap' }}>
                {countText}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ThoughtSummaryPanelProps = { stats: ThoughtStore | null; lastMs: (number | null)[]; identities: string[]; lang: Lang };

function ThoughtSummaryPanel({ stats, lastMs, identities, lang }: ThoughtSummaryPanelProps) {
  const latest = new Map<string, { ms: number | null; seat: number }>();
  identities.forEach((id, idx) => {
    if (!id) return;
    const val = Array.isArray(lastMs) ? lastMs[idx] ?? null : null;
    latest.set(id, { ms: val, seat: idx });
  });

  const players = stats?.players || {};
  const identityList = Array.from(new Set([...(stats ? Object.keys(players) : []), ...DEFAULT_THOUGHT_CATALOG_IDS]));
  const items = identityList.map(id => {
    const raw = players[id];
    const mean = Number(raw?.mean) || 0;
    const count = Math.max(0, Number(raw?.count) || 0);
    const label = (typeof raw?.label === 'string' && raw.label.trim()) ? raw.label.trim() : thoughtLabelForIdentity(id);
    const lastEntry = latest.get(id) || null;
    return { id, label, mean, count, lastEntry };
  });

  items.sort((a, b) => {
    const aHas = a.count > 0;
    const bHas = b.count > 0;
    if (aHas && bHas) {
      if (a.mean !== b.mean) return a.mean - b.mean;
      return a.label.localeCompare(b.label);
    }
    if (aHas) return -1;
    if (bHas) return 1;
    return a.label.localeCompare(b.label);
  });

  const maxMean = Math.max(0, ...items.filter(it => it.count > 0).map(it => it.mean));
  const scale = maxMean > 0 ? maxMean : 1;
  const title = lang === 'en' ? 'Thought time by identity' : '思考耗时（按身份）';
  const subtitle = lang === 'en'
    ? 'X-axis = running average thought time (ms); sorted by shortest first'
    : '横轴=累计平均思考时长（毫秒），按耗时从短到长排序';
  const fmt = (v:number|null) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    if (v >= 1000) return v.toFixed(0);
    return v.toFixed(1);
  };
  const countLabel = lang === 'en' ? 'n=' : '次数=';
  const lastLabel = lang === 'en' ? 'Latest' : '最近';
  const seatLabelPrefix = lang === 'en' ? 'Seat ' : '座位';
  const colon = lang === 'en' ? ': ' : '：';
  const barColor = '#60a5fa';
  const layoutStyle = { display:'grid', gridTemplateColumns:'200px 1fr 80px 140px', gap:8, rowGap:10 } as const;
  const wrapSeatTag = (tag:string) => {
    if (!tag) return '';
    return lang === 'en' ? ` (${seatLabelPrefix}${tag})` : `（${seatLabelPrefix}${tag}）`;
  };

  return (
    <div style={{ border:'1px dashed #e5e7eb', borderRadius:8, padding:'12px 14px', marginBottom:12, background:'#f9fafb' }}>
      <div style={{ fontWeight:700, marginBottom:2 }}>{title}</div>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>{subtitle}</div>
      <div style={layoutStyle}>
        {items.map(item => {
          const pct = item.count > 0 ? Math.min(1, item.mean / scale || 0) : 0;
          const last = item.lastEntry;
          const seatTag = last ? `${seatLabel(last.seat, lang)}` : '';
          const lastValue = last ? last.ms : null;
          return (
            <div key={item.id} style={{ display:'contents' }}>
              <div style={{ fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</div>
              <div style={{ position:'relative', height:18, background:'#e5e7eb33', borderRadius:9999, overflow:'hidden', border:'1px solid #e5e7eb' }}>
                <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${pct*100}%`, background:barColor, transition:'width 0.3s ease', borderRadius:9999 }} />
              </div>
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', textAlign:'right' }}>{item.count > 0 ? `${fmt(item.mean)} ms` : '—'}</div>
              <div style={{ fontSize:12, color:'#374151' }}>
                <div>{countLabel}{item.count}</div>
                <div>
                  {lastLabel}{colon}{lastValue != null ? `${fmt(lastValue)} ms` : '—'}
                  {wrapSeatTag(seatTag)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KnockoutPanel() {
  const { lang } = useI18n();
  const humanOptionLabel = lang === 'en' ? 'Human' : '人类选手';
  const humanProviderLabel = lang === 'en' ? 'Human player' : '人类选手';
  const [settings, setSettings] = useState<KnockoutSettings>(() => {
    if (typeof window === 'undefined') return defaultKnockoutSettings();
    try {
      const stored = localStorage.getItem(KO_SETTINGS_STORAGE);
      if (stored) {
        return sanitizeKnockoutSettings(JSON.parse(stored));
      }
    } catch {}
    return defaultKnockoutSettings();
  });
  const [entries, setEntries] = useState<KnockoutEntry[]>(() => {
    if (typeof window === 'undefined') return makeDefaultKnockoutEntries();
    try {
      const stored = localStorage.getItem(KO_ENTRY_STORAGE);
      if (stored) {
        const parsed = JSON.parse(stored);
        const normalized = normalizeKnockoutEntries(parsed);
        if (normalized?.length) return normalized;
      }
      const legacySeed = localStorage.getItem('ddz_knockout_seed');
      if (legacySeed) {
        const names = legacySeed.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (names.length >= 2) {
          const provisional = names.map((name, idx) => ({
            id: makeKnockoutEntryId(),
            choice: KO_DEFAULT_CHOICES[idx % KO_DEFAULT_CHOICES.length] ?? 'built-in:greedy-max',
            name,
          }));
          const normalized = normalizeKnockoutEntries(provisional);
          if (normalized.length) return normalized;
        }
      }
    } catch {}
    return makeDefaultKnockoutEntries();
  });
  const [rounds, setRounds] = useState<KnockoutRound[]>([]);
  const applyRoundsUpdate = useCallback((update: KnockoutRound[] | ((prev: KnockoutRound[]) => KnockoutRound[])) => {
    if (typeof update === 'function') {
      setRounds(prev => {
        const next = (update as (prev: KnockoutRound[]) => KnockoutRound[])(prev);
        roundsRef.current = next;
        return next;
      });
    } else {
      roundsRef.current = update;
      setRounds(update);
    }
  }, [setRounds]);
  const [currentMatch, setCurrentMatch] = useState<KnockoutMatchContext | null>(null);
  const currentMatchRef = useRef<KnockoutMatchContext | null>(null);
  useEffect(() => { currentMatchRef.current = currentMatch; }, [currentMatch]);
  const [matchKey, setMatchKey] = useState(0);
  const matchKeyRef = useRef(matchKey);
  useEffect(() => { matchKeyRef.current = matchKey; }, [matchKey]);
  const [liveTotals, setLiveTotals] = useState<[number, number, number] | null>(null);
  const liveTotalsRef = useRef<[number, number, number] | null>(null);
  useEffect(() => { liveTotalsRef.current = liveTotals; }, [liveTotals]);
  const [seriesTotals, setSeriesTotals] = useState<[number, number, number] | null>(null);
  const seriesTotalsRef = useRef<[number, number, number] | null>(seriesTotals);
  useEffect(() => { seriesTotalsRef.current = seriesTotals; }, [seriesTotals]);
  const [nextMatchInitialTotals, setNextMatchInitialTotals] = useState<[number, number, number] | null>(null);
  const [seriesRounds, setSeriesRounds] = useState<number>(() => settings.roundsPerGroup);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [overtimeReason, setOvertimeReason] = useState<'lowest' | 'final'>('lowest');
  const overtimeCountRef = useRef(overtimeCount);
  useEffect(() => { overtimeCountRef.current = overtimeCount; }, [overtimeCount]);
  const [liveRunning, setLiveRunning] = useState(false);
  const liveRunningRef = useRef(liveRunning);
  useEffect(() => { liveRunningRef.current = liveRunning; }, [liveRunning]);
  const [livePaused, setLivePaused] = useState(false);
  const [automationActive, setAutomationActive] = useState(false);
  const [finalStandings, setFinalStandings] = useState<KnockoutFinalStandings | null>(null);
  const finalStandingsRef = useRef<KnockoutFinalStandings | null>(finalStandings);
  useEffect(() => { finalStandingsRef.current = finalStandings; }, [finalStandings]);
  const livePanelRef = useRef<LivePanelHandle | null>(null);
  const roundsRef = useRef<KnockoutRound[]>(rounds);
  const finalTrioOnlyRef = useRef(false);
  useEffect(() => {
    roundsRef.current = rounds;
    finalTrioOnlyRef.current = isSingleTrioTournament(rounds);
  }, [rounds]);
  const entriesRef = useRef<KnockoutEntry[]>(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  const autoRunRef = useRef(false);
  const autoScheduleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allFileRef = useRef<HTMLInputElement|null>(null);
  const [matchLog, setMatchLog] = useState<string[]>([]);
  const matchLogRef = useRef<string[]>(matchLog);
  useEffect(() => { matchLogRef.current = matchLog; }, [matchLog]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(KO_SETTINGS_STORAGE, JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedRounds = localStorage.getItem('ddz_knockout_rounds');
      if (storedRounds) {
        const parsed = JSON.parse(storedRounds);
        if (Array.isArray(parsed)) {
          applyRoundsUpdate(normalizeKnockoutRounds(parsed as KnockoutRound[]));
        }
      }
      localStorage.removeItem('ddz_knockout_seed');
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = entries.map(persistableKnockoutEntry);
      localStorage.setItem(KO_ENTRY_STORAGE, JSON.stringify(payload));
    } catch {}
  }, [entries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('ddz_knockout_rounds', JSON.stringify(rounds)); } catch {}
  }, [rounds]);

  useEffect(() => {
    if (rounds.length) return;
    autoRunRef.current = false;
    setAutomationActive(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(settings.roundsPerGroup);
    setOvertimeCount(0);
    setLiveRunning(false);
    setLivePaused(false);
    setFinalStandings(null);
  }, [rounds.length]);

  useEffect(() => () => {
    if (autoScheduleTimer.current != null) {
      clearTimeout(autoScheduleTimer.current);
      autoScheduleTimer.current = null;
    }
  }, []);

  const participantLabel = (idx: number) => (lang === 'en' ? `Player ${idx + 1}` : `选手${idx + 1}`);
  const updateSettings = (patch: Partial<KnockoutSettings>) => {
    setSettings(prev => sanitizeKnockoutSettings({ ...prev, ...patch }));
  };
  const { enabled, roundsPerGroup, startScore, bid, four2, farmerCoop } = settings;

  const setAutomation = useCallback((active: boolean) => {
    autoRunRef.current = active;
    if (!active && autoScheduleTimer.current != null) {
      clearTimeout(autoScheduleTimer.current);
      autoScheduleTimer.current = null;
    }
    setAutomationActive(active);
  }, []);

  useEffect(() => {
    if (!finalStandings?.placements?.length) return;
    setAutomation(false);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    setNextMatchInitialTotals(null);
    const panel = livePanelRef.current;
    if (panel?.isRunning()) {
      try {
        panel.stop();
      } catch (err) {
        console.error('[knockout] stop after finals failed', err);
      }
    }
    setLiveRunning(false);
    setLivePaused(false);
  }, [finalStandings, setAutomation]);

  const handleAllFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const entryIdentity = (entry: KnockoutEntry) => {
    const payload: Record<string, string> = {
      name: entry.name.trim(),
      choice: entry.choice,
    };
    if (entry.choice.startsWith('ai:')) {
      payload.model = entry.model.trim();
    }
    if (entry.choice === 'http') {
      payload.httpBase = (entry.keys?.httpBase || '').trim();
    }
    return JSON.stringify(payload);
  };

  const entryToken = (entry: KnockoutEntry, slot: number) => {
    const payload: Record<string, string | number> = {
      id: entry.id,
      slot,
      name: entry.name.trim(),
      choice: entry.choice,
    };
    if (entry.choice.startsWith('ai:')) {
      const model = entry.model.trim();
      if (model) payload.model = model;
    }
    if (entry.choice === 'http') {
      const base = (entry.keys?.httpBase || '').trim();
      if (base) payload.httpBase = base;
    }
    return JSON.stringify(payload);
  };

  const handleGenerate = () => {
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament before generating a bracket.' : '请先启用淘汰赛。');
      setNotice(null);
      return;
    }
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setFinalStandings(null);
    const roster = entries.map((entry, idx) => ({
      token: entryToken(entry, idx + 1),
      identity: entryIdentity(entry),
    })).filter(item => item.identity);
    if (roster.length < 3) {
      setError(lang === 'en' ? 'Add at least three participants.' : '请至少添加三名参赛选手。');
      setNotice(null);
      applyRoundsUpdate([]);
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
      }
      return;
    }
    const uniqueTokens = new Set(roster.map(item => item.identity));
    if (uniqueTokens.size < roster.length) {
      setError(lang === 'en' ? 'Participant configurations must be unique.' : '参赛选手配置需要唯一，请调整选择。');
      setNotice(null);
      return;
    }
    const shuffled = shuffleArray(roster.map(item => item.token));
    const firstRoundMatches = buildMatchesFromPool(shuffled, 0);
    if (!firstRoundMatches.length) {
      setError(lang === 'en' ? 'Unable to build initial groups.' : '无法生成首轮对阵，请重试。');
      applyRoundsUpdate([]);
      return;
    }
    const firstRound: KnockoutRound = { matches: firstRoundMatches };
    applyRoundsUpdate([firstRound]);
    setError(null);
    setNotice(lang === 'en'
      ? `Participants shuffled into groups of three where possible. Each trio plays ${roundsPerGroup} game(s).`
      : `已尽量按每组三人随机分组。每组三人对局 ${roundsPerGroup} 局。`);
  };

  const handleReset = () => {
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(settings.roundsPerGroup);
    setOvertimeCount(0);
    setFinalStandings(null);
    applyRoundsUpdate([]);
    setError(null);
    setNotice(null);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
    }
  };

  const handleResetAll = () => {
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(KO_DEFAULT_SETTINGS.roundsPerGroup);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    setSettings(defaultKnockoutSettings());
    setEntries(makeDefaultKnockoutEntries());
    setFinalStandings(null);
    applyRoundsUpdate([]);
    setError(null);
    setNotice(null);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(KO_SETTINGS_STORAGE); } catch {}
      try { localStorage.removeItem(KO_ENTRY_STORAGE); } catch {}
      try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
    }
  };

  const handleToggleEliminated = (roundIdx: number, matchIdx: number, player: string) => {
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament to record eliminations.' : '请先启用淘汰赛以记录淘汰结果。');
      setNotice(null);
      return;
    }
    setFinalStandings(null);
    applyRoundsUpdate(prev => {
      const draft = cloneKnockoutRounds(prev);
      const match = draft[roundIdx]?.matches?.[matchIdx];
      if (!match) return prev;
      const nextElimination = match.eliminated === player ? null : player;
      applyEliminationToDraft(draft, roundIdx, matchIdx, nextElimination);
      return draft;
    });
  };

  const mergeAliasAndProvider = (alias: string, providerLabel: string) => {
    const trimmedAlias = alias.trim();
    const trimmedProvider = providerLabel.trim();
    if (trimmedAlias && trimmedProvider) {
      if (trimmedAlias.toLowerCase() === trimmedProvider.toLowerCase()) {
        return trimmedAlias;
      }
      return `${trimmedAlias} · ${trimmedProvider}`;
    }
    return trimmedAlias || trimmedProvider;
  };

  const displayName = (value: KnockoutPlayer | null) => {
    if (value === KO_BYE) return lang === 'en' ? 'BYE' : '轮空';
    if (!value) return lang === 'en' ? 'TBD' : '待定';
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          const entryId = typeof (parsed as any).id === 'string' ? (parsed as any).id : '';
          const entry = entryId ? entries.find(item => item.id === entryId) : null;
          const aliasFromEntry = (entry?.name || '').trim();
          const aliasFromToken = typeof (parsed as any).name === 'string' ? ((parsed as any).name as string).trim() : '';
          const alias = aliasFromEntry || aliasFromToken;
          const rawChoice = entry?.choice || (typeof (parsed as any).choice === 'string' ? (parsed as any).choice as string : '');
          const normalizedChoice = KO_ALL_CHOICES.includes(rawChoice as BotChoice)
            ? (rawChoice as BotChoice)
            : null;
          let providerLabel = '';
          if (normalizedChoice) {
            if (normalizedChoice === 'human') {
              providerLabel = humanProviderLabel;
            } else {
              const model = (entry?.model || (typeof (parsed as any).model === 'string' ? (parsed as any).model as string : ''))
                .trim();
              const httpBase = (entry?.keys?.httpBase || (typeof (parsed as any).httpBase === 'string'
                ? (parsed as any).httpBase as string
                : ''))
                .trim();
              providerLabel = providerSummary(normalizedChoice, model, httpBase, lang);
            }
          }
          const merged = mergeAliasAndProvider(alias, providerLabel);
          if (merged) return merged;
          const slotNumber = Number((parsed as any).slot);
          if (Number.isFinite(slotNumber) && slotNumber >= 1) {
            return participantLabel(slotNumber - 1);
          }
          if (entry) {
            const idx = entries.findIndex(item => item.id === entry.id);
            if (idx >= 0) return participantLabel(idx);
          }
        }
      } catch {}
    }
    return String(value);
  };

  const podiumDisplayName = (value: KnockoutPlayer | null) => {
    if (!value || value === KO_BYE) return displayName(value);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        const entryId = typeof (parsed as any)?.id === 'string' ? (parsed as any).id : '';
        const entry = entryId ? entries.find(item => item.id === entryId) : null;
        const aliasFromEntry = (entry?.name || '').trim();
        const aliasFromToken = typeof (parsed as any)?.name === 'string' ? ((parsed as any).name as string).trim() : '';
        const alias = aliasFromEntry || aliasFromToken;
        const choiceFromEntry = entry?.choice;
        const choiceFromToken = typeof (parsed as any)?.choice === 'string' ? (parsed as any).choice as string : '';
        const normalizedChoice = KO_ALL_CHOICES.includes((choiceFromEntry || choiceFromToken) as BotChoice)
          ? (choiceFromEntry || choiceFromToken) as BotChoice
          : null;
        const modelFromEntry = entry?.model || '';
        const modelFromToken = typeof (parsed as any)?.model === 'string' ? (parsed as any).model as string : '';
        const httpFromEntry = entry?.keys?.httpBase || '';
        const httpFromToken = typeof (parsed as any)?.httpBase === 'string' ? (parsed as any).httpBase as string : '';
        const providerLabel = normalizedChoice
          ? providerSummary(
              normalizedChoice,
              (normalizedChoice.startsWith('ai:') ? (modelFromEntry || modelFromToken) : modelFromEntry) || '',
              normalizedChoice === 'http' ? (httpFromEntry || httpFromToken) : httpFromEntry,
              lang,
            )
          : '';
        const merged = mergeAliasAndProvider(alias, providerLabel);
        if (merged) return merged;
      } catch {}
    }
    return displayName(value);
  };

  const playerMeta = (value: KnockoutPlayer | null): { label: string; provider: string } => {
    const label = displayName(value);
    if (!value || value === KO_BYE) return { label, provider: '' };
    try {
      const parsed = JSON.parse(String(value));
      const entryId = typeof parsed?.id === 'string' ? parsed.id : '';
      const entry = entryId ? entries.find(item => item.id === entryId) : null;
      if (entry) {
        return {
          label,
          provider: entry.choice === 'human'
            ? humanProviderLabel
            : providerSummary(entry.choice, entry.model, entry.keys?.httpBase, lang),
        };
      }
      const rawChoice = typeof parsed?.choice === 'string' ? parsed.choice : '';
      if (KO_ALL_CHOICES.includes(rawChoice as BotChoice)) {
        const model = typeof parsed?.model === 'string' ? parsed.model : '';
        const httpBase = typeof parsed?.httpBase === 'string' ? parsed.httpBase : '';
        return {
          label,
          provider: rawChoice === 'human'
            ? humanProviderLabel
            : providerSummary(rawChoice as BotChoice, model, httpBase, lang),
        };
      }
    } catch {}
    return { label, provider: '' };
  };

  const fallbackLive = useMemo(() => ({
    seats: KO_DEFAULT_CHOICES.slice(0, 3),
    seatModels: ['', '', ''],
    seatKeys: [{}, {}, {}] as BotCredentials[],
    delays: [KO_DEFAULT_DELAY, KO_DEFAULT_DELAY, KO_DEFAULT_DELAY],
    timeouts: [KO_DEFAULT_TIMEOUT, KO_DEFAULT_TIMEOUT, KO_DEFAULT_TIMEOUT],
  }), []);

  const buildMatchContext = (roundIdx: number, matchIdx: number): KnockoutMatchContext | null => {
    const round = roundsRef.current?.[roundIdx];
    const match = round?.matches?.[matchIdx];
    if (!match) return null;
    const tokens = match.players.filter(p => p && p !== KO_BYE) as string[];
    if (tokens.length !== 3) return null;
    const details = tokens.map(token => {
      try {
        const parsed = JSON.parse(String(token));
        const id = parsed?.id;
        if (!id) return null;
        const entry = entriesRef.current.find(item => item.id === id);
        if (!entry) return null;
        const rawSlot = Number(parsed?.slot);
        const slot = Number.isFinite(rawSlot) ? rawSlot : null;
        return { token, entry, slot };
      } catch {
        return null;
      }
    });
    if (details.some(detail => !detail)) return null;
    return {
      roundIdx,
      matchIdx,
      tokens: details.map(detail => detail!.token),
      seats: details.map(detail => detail!.entry.choice),
      seatModels: details.map(detail => detail!.entry.model || ''),
      seatKeys: details.map(detail => ({ ...(detail!.entry.keys || {}) })),
      delays: details.map(detail => {
        const raw = Number(detail!.entry.delayMs);
        return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : KO_DEFAULT_DELAY;
      }),
      timeouts: details.map(detail => {
        const raw = Number(detail!.entry.timeoutSecs);
        return Number.isFinite(raw) ? Math.max(5, Math.floor(raw)) : KO_DEFAULT_TIMEOUT;
      }),
      labels: details.map(detail => {
        const slot = detail!.slot;
        if (typeof slot === 'number' && Number.isFinite(slot) && slot > 0) {
          return participantLabel(slot - 1);
        }
        return displayName(detail!.token);
      }),
    };
  };

  const queueReplayStart = useCallback((targetKey: number) => {
    if (finalStandingsRef.current?.placements?.length) return;
    const attemptStart = (tries: number) => {
      if (finalStandingsRef.current?.placements?.length) return;
      const panel = livePanelRef.current;
      if (!panel) {
        if (tries < 40) {
          setTimeout(() => attemptStart(tries + 1), 50);
        }
        return;
      }
      if (!currentMatchRef.current) {
        if (tries < 40) {
          setTimeout(() => attemptStart(tries + 1), 50);
        }
        return;
      }
      if (typeof panel.getInstanceId === 'function') {
        const instance = panel.getInstanceId();
        if (instance !== targetKey) {
          if (tries < 40) {
            setTimeout(() => attemptStart(tries + 1), 50);
          }
          return;
        }
      }
      if (panel.isRunning()) return;
      panel.start()
        .then(() => {
          setTimeout(() => {
            if (!panel.isRunning() && tries < 40) {
              attemptStart(tries + 1);
            }
          }, 120);
        })
        .catch(err => console.error('[knockout] auto replay start failed', err));
    };
    setTimeout(() => attemptStart(0), 0);
  }, []);

  const launchMatch = (roundIdx: number, matchIdx: number) => {
    const context = buildMatchContext(roundIdx, matchIdx);
    if (!context) {
      setAutomation(false);
      setNotice(lang === 'en'
        ? 'Unable to launch the next trio. Please verify participant settings.'
        : '无法启动下一组三人对局，请检查参赛设置。');
      return false;
    }
    currentMatchRef.current = context;
    setCurrentMatch(context);
    const baseScore = Number.isFinite(startScore) ? startScore : 0;
    const baseTotals = [baseScore, baseScore, baseScore] as [number, number, number];
    setSeriesRounds(roundsPerGroup);
    setSeriesTotals(baseTotals);
    setNextMatchInitialTotals(null);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    setLiveTotals(baseTotals);
    const nextKey = matchKeyRef.current + 1;
    setMatchKey(nextKey);
    queueReplayStart(nextKey);
    return true;
  };

  const scheduleNextMatch = useCallback(() => {
    if (finalStandingsRef.current?.placements?.length) {
      if (autoRunRef.current) {
        setAutomation(false);
        setNotice(lang === 'en'
          ? 'Final standings are locked in. No further knockout trios will run.'
          : '最终排名已生成，将不再继续淘汰赛对局。');
      }
      return;
    }
    if (!autoRunRef.current) return;
    if (livePanelRef.current?.isRunning()) return;
    const pendingContext = currentMatchRef.current;
    if (overtimeCountRef.current > 0 && pendingContext) {
      const round = roundsRef.current?.[pendingContext.roundIdx];
      const match = round?.matches?.[pendingContext.matchIdx];
      if (match && !match.eliminated) {
        const active = match.players.filter(p => p && p !== KO_BYE);
        if (active.length >= 3) {
          if (seriesTotalsRef.current) setLiveTotals(seriesTotalsRef.current);
          const baseScore = Number.isFinite(startScore) ? startScore : 0;
          const baseTotals = [baseScore, baseScore, baseScore] as [number, number, number];
          setNextMatchInitialTotals(prev => prev ?? baseTotals);
          setSeriesRounds(3);
          const nextKey = matchKeyRef.current + 1;
          setMatchKey(nextKey);
          queueReplayStart(nextKey);
          return;
        }
      }
    }
    const currentRounds = roundsRef.current || [];
    const next = findNextPlayableMatch(currentRounds);
    if (!next) {
      const normalized = normalizeKnockoutRounds(currentRounds);
      if (encodeRoundsSignature(normalized) !== encodeRoundsSignature(currentRounds)) {
        applyRoundsUpdate(normalized);
        if (autoRunRef.current) {
          setTimeout(() => {
            if (autoRunRef.current) scheduleNextMatch();
          }, 0);
        }
        return;
      }
      setAutomation(false);
      setNotice(lang === 'en' ? 'All scheduled rounds are complete.' : '当前所有轮次的对局均已完成。');
      return;
    }
    const round = roundsRef.current?.[next.roundIdx];
    const match = round?.matches?.[next.matchIdx];
    if (!match) {
      setAutomation(false);
      return;
    }
    const active = match.players.filter(p => p && p !== KO_BYE);
    if (active.length < 3) {
      const byeToken = match.players.find(p => p === KO_BYE || !p) ?? KO_BYE;
      setSeriesTotals(null);
      setLiveTotals(null);
      setSeriesRounds(roundsPerGroup);
      setOvertimeCount(0);
      setOvertimeReason('lowest');
      applyRoundsUpdate(prev => {
        const draft = cloneKnockoutRounds(prev);
        applyEliminationToDraft(draft, next.roundIdx, next.matchIdx, byeToken);
        return draft;
      });
      setTimeout(() => { if (autoRunRef.current) scheduleNextMatch(); }, 0);
      return;
    }
    const launched = launchMatch(next.roundIdx, next.matchIdx);
    if (!launched) {
      setAutomation(false);
    }
  }, [applyRoundsUpdate, lang, launchMatch, roundsPerGroup, setAutomation, setNotice]);

  useEffect(() => {
    if (!automationActive) return;
    if (!autoRunRef.current) return;
    if (!roundsRef.current?.length) return;
    if (finalStandingsRef.current?.placements?.length) {
      setAutomation(false);
      return;
    }
    if (livePanelRef.current?.isRunning()) return;
    if (liveRunningRef.current) return;
    const currentRounds = roundsRef.current || [];
    const pending = findNextPlayableMatch(currentRounds);
    if (!pending) {
      const normalized = normalizeKnockoutRounds(currentRounds);
      if (encodeRoundsSignature(normalized) !== encodeRoundsSignature(currentRounds)) {
        applyRoundsUpdate(normalized);
        if (autoRunRef.current) {
          setTimeout(() => {
            if (autoRunRef.current) scheduleNextMatch();
          }, 0);
        }
        return;
      }
      setAutomation(false);
      return;
    }
    const ctx = currentMatchRef.current;
    if (ctx && ctx.roundIdx === pending.roundIdx && ctx.matchIdx === pending.matchIdx && overtimeCountRef.current === 0) {
      return;
    }
    if (autoScheduleTimer.current != null) return;
    autoScheduleTimer.current = setTimeout(() => {
      autoScheduleTimer.current = null;
      if (!autoRunRef.current) return;
      if (livePanelRef.current?.isRunning()) return;
      if (liveRunningRef.current) return;
      const snapshot = roundsRef.current || [];
      const next = findNextPlayableMatch(snapshot);
      if (!next) {
        const normalized = normalizeKnockoutRounds(snapshot);
        if (encodeRoundsSignature(normalized) !== encodeRoundsSignature(snapshot)) {
          applyRoundsUpdate(normalized);
          return;
        }
        setAutomation(false);
        return;
      }
      scheduleNextMatch();
    }, 0);
  }, [applyRoundsUpdate, automationActive, rounds, scheduleNextMatch, setAutomation]);

  const handleLiveFinished = (result: LivePanelFinishPayload) => {
    setLiveRunning(false);
    setLivePaused(false);
    if (finalStandingsRef.current?.placements?.length) {
      setAutomation(false);
      return;
    }
    if (result.aborted) {
      setAutomation(false);
      return;
    }
    const endedEarly = !!result.endedEarlyForNegative;
    if (!result.completedAll && !endedEarly) {
      setNotice(lang === 'en'
        ? 'The trio stopped before finishing all games; continuing with recorded scores.'
        : '该组三人未跑完全部局数，自动流程将继续使用已有积分。');
    }
    const ctx = currentMatchRef.current;
    if (!ctx) return;
    const wasFinalMatch = isFinalRoundMatch(roundsRef.current || [], ctx.roundIdx, ctx.matchIdx);
    const totals = result.totals || liveTotalsRef.current;
    if (!totals) return;
    const baseScore = Number.isFinite(startScore) ? startScore : 0;
    const baseTotals = [baseScore, baseScore, baseScore] as [number, number, number];
    const totalsTuple = [0, 0, 0] as [number, number, number];
    for (let i = 0; i < 3; i++) {
      const raw = Number((totals as number[])[i]);
      totalsTuple[i] = Number.isFinite(raw) ? raw : baseScore;
    }
    const epsilon = 1e-6;
    const finishedCount = Number(result.finishedCount) || 0;
    const totalsUnchanged = totalsTuple.every((total, idx) => Math.abs(total - baseTotals[idx]) <= epsilon);
    const shouldRetry = finishedCount <= 0 || (totalsUnchanged && !result.completedAll && !endedEarly);
    if (shouldRetry) {
      setLiveTotals(baseTotals);
      setSeriesTotals(baseTotals);
      setNextMatchInitialTotals(baseTotals);
      setOvertimeCount(0);
      setOvertimeReason('lowest');
      const message = lang === 'en'
        ? 'No completed games were recorded. Restarting this trio automatically.'
        : '未记录有效局数，正在自动重新启动该组三人对局。';
      setNotice(message);
      const nextKey = matchKeyRef.current + 1;
      setMatchKey(nextKey);
      queueReplayStart(nextKey);
      return;
    }
    setLiveTotals(totalsTuple);
    setSeriesTotals(totalsTuple);
    setNextMatchInitialTotals(null);
    const scored = ctx.tokens.map((token, idx) => {
      const val = Number(totals[idx]);
      return {
        token,
        total: Number.isFinite(val) ? val : Number.POSITIVE_INFINITY,
      };
    });
    const ranked = scored
      .filter(entry => !!entry.token)
      .sort((a, b) => a.total - b.total);
    const finalTrioOnly = finalTrioOnlyRef.current;
    const placementsDesc = wasFinalMatch
      ? ctx.tokens
          .map((token, idx) => ({ token, total: totalsTuple[idx] }))
          .filter(entry => !!entry.token && entry.token !== KO_BYE)
          .sort((a, b) => b.total - a.total)
      : null;
    const seatMeta = ctx.tokens.map((token, idx) => ({
      seatIndex: idx,
      token,
      label: ctx.labels[idx] || displayName(token),
      choice: ctx.seats[idx],
      model: ctx.seatModels[idx] || '',
      httpBase: ctx.seatKeys[idx]?.httpBase || '',
    }));
    const rankedSummary = ranked.map(entry => {
      const pos = ctx.tokens.indexOf(entry.token);
      const labelText = pos >= 0 ? (ctx.labels[pos] || displayName(entry.token)) : displayName(entry.token);
      return { token: entry.token, label: labelText, total: entry.total };
    });
    const baseMetadata = {
      summary: `Round ${ctx.roundIdx + 1} · Match ${ctx.matchIdx + 1}`,
      timestamp: new Date().toISOString(),
      roundIndex: ctx.roundIdx,
      matchIndex: ctx.matchIdx,
      finishedCount,
      requestedRounds: seriesRounds,
      endedEarly,
      totals: totalsTuple,
      ranked: rankedSummary,
      seatMeta,
      farmerCoop,
      bid,
      four2,
      startScore,
      overtimeCount: overtimeCountRef.current,
      placementsDesc,
    };
    const pushKnockoutLog = (extra?: Record<string, any>) => {
      const lines = (matchLogRef.current || []).map(line => String(line));
      const runId = `knockout-${ctx.roundIdx + 1}-${ctx.matchIdx + 1}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      void postRunLogDelivery({
        runId,
        mode: 'knockout',
        logLines: lines,
        metadata: { ...baseMetadata, ...(extra || {}) },
      });
    };
    if (wasFinalMatch) {
      const trioTotals = ctx.tokens.map((token, idx) => ({ token, total: totalsTuple[idx] }))
        .filter(entry => !!entry.token && entry.token !== KO_BYE);
      const sortedTotals = trioTotals.slice().sort((a, b) => b.total - a.total);
      const championTie = sortedTotals.length >= 2
        ? Math.abs(sortedTotals[0].total - sortedTotals[1].total) <= epsilon
        : false;
      if (championTie) {
        if (finalStandingsRef.current?.placements?.length) {
          setAutomation(false);
          return;
        }
        const tiedChampions = sortedTotals
          .filter(entry => Math.abs(entry.total - sortedTotals[0].total) <= epsilon)
          .map(entry => entry.token);
        const tiedLabels = tiedChampions
          .map(token => podiumDisplayName(token))
          .join(lang === 'en' ? ', ' : '、');
        const nextAttempt = overtimeCountRef.current + 1;
        setOvertimeCount(nextAttempt);
        setOvertimeReason('final');
        setNextMatchInitialTotals(baseTotals);
        setSeriesRounds(3);
        setFinalStandings(null);
        setNotice(lang === 'en'
          ? `Final round tie for champion between ${tiedLabels}. Starting 3-game playoff #${nextAttempt}.`
          : `决赛冠军积分出现平局（${tiedLabels}），开始第 ${nextAttempt} 次加时赛（3 局）。`);
        const nextKey = matchKeyRef.current + 1;
        setMatchKey(nextKey);
        queueReplayStart(nextKey);
        return;
      }
    }
    const lowest = ranked[0];
    if (!lowest) {
      setAutomation(false);
      return;
    }
    if (!Number.isFinite(lowest.total)) {
      setAutomation(false);
      setNotice(lang === 'en'
        ? 'The trio did not record valid scores. Please review the results and mark the eliminated player manually.'
        : '该组三人未产生有效积分，请核对结果并手动标记淘汰选手。');
      return;
    }
    const tiedLowest = ranked.filter(entry => Math.abs(entry.total - lowest.total) <= epsilon);
    const lowestTieForcesReplay = tiedLowest.length !== 1 && (!wasFinalMatch || !finalTrioOnly);
    if (lowestTieForcesReplay) {
      const tiedLabels = tiedLowest
        .map(entry => displayName(entry.token))
        .join(lang === 'en' ? ', ' : '、');
      const nextAttempt = overtimeCountRef.current + 1;
      setOvertimeCount(nextAttempt);
      setOvertimeReason('lowest');
      setNextMatchInitialTotals(baseTotals);
      setSeriesRounds(3);
      setNotice(lang === 'en'
        ? `Round ${ctx.roundIdx + 1}${endedEarly ? ' ended early after a negative score;' : ''} lowest score tie among ${tiedLabels}. Starting 3-game playoff #${nextAttempt}.`
        : `第 ${ctx.roundIdx + 1} 轮${endedEarly ? '出现负分提前结束，' : ''}积分最低出现平局（${tiedLabels}），开始第 ${nextAttempt} 次加时赛（3 局）。`);
      const nextKey = matchKeyRef.current + 1;
      setMatchKey(nextKey);
      queueReplayStart(nextKey);
      return;
    }
    const eliminatedToken = tiedLowest[0]?.token;
    if (!eliminatedToken) {
      setAutomation(false);
      return;
    }
    const label = displayName(eliminatedToken);
    applyRoundsUpdate(prev => {
      const draft = cloneKnockoutRounds(prev);
      applyEliminationToDraft(draft, ctx.roundIdx, ctx.matchIdx, eliminatedToken);
      return draft;
    });
    setSeriesRounds(roundsPerGroup);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    if (wasFinalMatch) {
      const ordered = (placementsDesc && placementsDesc.length
        ? placementsDesc
        : ranked.slice().reverse())
        .slice(0, 3);
      if (ordered.length) {
        setFinalStandings({ placements: ordered });
      } else {
        setFinalStandings(null);
      }
      if (ordered.length >= 3) {
        const championLabel = podiumDisplayName(ordered[0].token);
        const runnerUpLabel = podiumDisplayName(ordered[1].token);
        const thirdLabel = podiumDisplayName(ordered[2].token);
        setNotice(lang === 'en'
          ? `Final standings — Champion: ${championLabel}, Runner-up: ${runnerUpLabel}, Third: ${thirdLabel}.`
          : `最终排名：冠军 ${championLabel}，亚军 ${runnerUpLabel}，季军 ${thirdLabel}。`);
      } else {
        setNotice(lang === 'en'
          ? `Final round complete. Eliminated ${label}${endedEarly ? ' after an early finish caused by a negative score.' : '.'}`
          : `决赛结束：淘汰 ${label}${endedEarly ? '（因出现负分提前结束）' : ''}`);
      }
      pushKnockoutLog({
        eliminated: { token: eliminatedToken, label },
        finalPlacements: ordered,
      });
      setAutomation(false);
      return;
    }
    setFinalStandings(null);
    setNotice(lang === 'en'
      ? `Round ${ctx.roundIdx + 1}: eliminated ${label}${endedEarly ? ' after an early finish caused by a negative score.' : '.'}`
      : `第 ${ctx.roundIdx + 1} 轮淘汰：${label}${endedEarly ? '（因出现负分提前结束）' : ''}`);
    pushKnockoutLog({
      eliminated: { token: eliminatedToken, label },
    });
    setTimeout(() => { if (autoRunRef.current) scheduleNextMatch(); else setAutomation(false); }, 0);
  };

  const handleStartRound = () => {
    if (livePanelRef.current?.isRunning() || liveRunning) return;
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament before starting.' : '请先启用淘汰赛再开始运行。');
      setNotice(null);
      return;
    }
    if (finalStandingsRef.current?.placements?.length) {
      setNotice(lang === 'en'
        ? 'Final standings are already available. Reset the bracket to run a new tournament.'
        : '最终排名已生成。如需重新比赛，请先重置对阵。');
      return;
    }
    if (!rounds.length) {
      setError(lang === 'en' ? 'Generate the bracket before starting.' : '请先生成淘汰赛对阵。');
      setNotice(null);
      return;
    }
    if (!findNextPlayableMatch(rounds)) {
      setNotice(lang === 'en' ? 'All rounds are already complete.' : '所有轮次已经完成。');
      return;
    }
    setError(null);
    setNotice(null);
    setAutomation(true);
    scheduleNextMatch();
  };

  const handlePauseRound = () => {
    if (!livePanelRef.current) return;
    if (!livePanelRef.current.isRunning()) return;
    livePanelRef.current.togglePause();
  };

  const handleStopRound = () => {
    setAutomation(false);
    setLivePaused(false);
    if (livePanelRef.current?.isRunning()) {
      livePanelRef.current.stop();
    }
  };

  const hasPendingMatch = useMemo(() => !!findNextPlayableMatch(rounds), [rounds]);
  const currentRoundNumber = useMemo(() => {
    if (!rounds.length) return null;
    for (let ridx = 0; ridx < rounds.length; ridx++) {
      const round = rounds[ridx];
      if (!round?.matches?.length) continue;
      const pending = round.matches.some(match => {
        const active = match.players.filter(p => p && p !== KO_BYE);
        if (!active.length) return false;
        if (active.length < 3) return !match.eliminated;
        return !match.eliminated;
      });
      if (pending) return ridx + 1;
    }
    return rounds.length;
  }, [rounds]);
  const podiumPlacements = useMemo(() => {
    if (!finalStandings?.placements?.length) return [] as { token: KnockoutPlayer; total: number | null }[];
    return finalStandings.placements
      .filter(entry => entry?.token && entry.token !== KO_BYE)
      .slice(0, 3)
      .map(entry => {
        const numericTotal = Number(entry.total);
        return {
          token: entry.token,
          total: Number.isFinite(numericTotal) ? numericTotal : null,
        };
      })
      .sort((a, b) => {
        const aScore = typeof a.total === 'number' ? a.total : Number.NEGATIVE_INFINITY;
        const bScore = typeof b.total === 'number' ? b.total : Number.NEGATIVE_INFINITY;
        return bScore - aScore;
      });
  }, [finalStandings]);

  const finalPlacementLookup = useMemo(() => {
    const map = new Map<string, { rank: number; total: number | null }>();
    podiumPlacements.forEach((placement, idx) => {
      const token = typeof placement.token === 'string' ? placement.token : null;
      if (!token) return;
      map.set(token, {
        rank: idx,
        total: typeof placement.total === 'number' ? placement.total : null,
      });
    });
    return map;
  }, [podiumPlacements]);

  const scoreboardTotals = useMemo(() => {
    if (liveTotals) return liveTotals;
    if (seriesTotals) return seriesTotals;
    if (!currentMatch) return null;
    const base = Number.isFinite(startScore) ? startScore : 0;
    return [base, base, base] as [number, number, number];
  }, [liveTotals, seriesTotals, currentMatch, startScore]);

  const initialTotalsForLive = nextMatchInitialTotals ?? seriesTotals;
  const seatsForLive = currentMatch ? currentMatch.seats : fallbackLive.seats;
  const modelsForLive = currentMatch ? currentMatch.seatModels : fallbackLive.seatModels;
  const keysForLive = currentMatch ? currentMatch.seatKeys : fallbackLive.seatKeys;
  const delaysForLive = currentMatch ? currentMatch.delays : fallbackLive.delays;
  const timeoutsForLive = currentMatch ? currentMatch.timeouts : fallbackLive.timeouts;

  const handleAddEntry = () => {
    setEntries(prev => {
      const choice = KO_ALL_CHOICES[prev.length % KO_ALL_CHOICES.length] ?? 'built-in:greedy-max';
      return [...prev, createDefaultKnockoutEntry(choice, prev)];
    });
  };

  const handleRemoveEntry = (id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
  };

  const handleEntryChoiceChange = (id: string, choice: BotChoice) => {
    setEntries(prev => prev.map(entry => {
      if (entry.id !== id) return entry;
      const others = prev.filter(e => e.id !== id);
      const suffix = deriveAutoAliasSuffix(entry.name, entry.choice);
      let nextName = entry.name;
      if (suffix !== undefined) {
        if (suffix) {
          const candidate = `${choiceLabel(choice)}${suffix}`;
          nextName = others.some(o => o.name.trim() === candidate)
            ? defaultAliasForChoice(choice, others)
            : candidate;
        } else {
          nextName = defaultAliasForChoice(choice, others);
        }
      }
      const nextKeys = sanitizeKnockoutKeys(choice, entry.keys);
      const nextModel = choice.startsWith('ai:')
        ? (choice === entry.choice ? entry.model : '')
        : '';
      return { ...entry, choice, name: nextName, keys: nextKeys, model: nextModel };
    }));
  };

  const updateEntry = (id: string, mutator: (entry: KnockoutEntry) => KnockoutEntry) => {
    setEntries(prev => prev.map(entry => entry.id === id ? mutator(entry) : entry));
  };

  const handleEntryModelChange = (id: string, model: string) => {
    updateEntry(id, entry => ({ ...entry, model }));
  };

  const handleEntryKeyChange = (id: string, key: keyof BotCredentials, value: string) => {
    updateEntry(id, entry => ({ ...entry, keys: { ...(entry.keys || {}), [key]: value } }));
  };

  const handleEntryDelayChange = (id: string, value: string) => {
    const num = Math.max(0, Math.floor(Number(value) || 0));
    updateEntry(id, entry => ({ ...entry, delayMs: num }));
  };

  const handleEntryTimeoutChange = (id: string, value: string) => {
    const num = Math.max(5, Math.floor(Number(value) || 0));
    updateEntry(id, entry => ({ ...entry, timeoutSecs: num }));
  };

  const participantsTitle = lang === 'en' ? 'Participants' : '参赛选手';
  const participantsHint = lang === 'en'
    ? 'Pick bots, AIs, or a human player just like regular matches.'
    : '从常规赛使用的内置 / 外置 AI 或人类选手中选择参赛选手。';

  const intervalTitle = lang === 'en' ? 'Min play interval (ms)' : '最小间隔 (ms)';
  const timeoutTitle = lang === 'en' ? 'Think timeout (s)' : '弃牌时间（秒）';

  return (
    <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
      <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>{lang === 'en' ? 'Knockout tournament' : '淘汰赛'}</div>
      <div style={{ fontSize:14, color:'#4b5563', marginBottom:12 }}>
        {lang === 'en'
          ? 'Generate a single-elimination bracket. Add participants below; byes are inserted automatically when required.'
          : '快速生成单败淘汰赛对阵。先在下方选择参赛选手，不足时会自动补齐轮空。'}
      </div>
      <div style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:10 }}>{lang === 'en' ? 'Match settings' : '对局设置'}</div>
        <div
          style={{
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(0, 1fr))',
            gap:12,
            gridAutoFlow:'row dense',
            alignItems:'center',
          }}
        >
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Enable match' : '启用对局'}
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => updateSettings({ enabled: e.target.checked })}
                />
              </label>
              <button
                onClick={handleResetAll}
                style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
              >{lang === 'en' ? 'Reset' : '清空'}</button>
            </div>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8 }}>
            {lang === 'en' ? 'Games per trio' : '每组三人局数'}
            <input
              type="number"
              min={1}
              step={1}
              value={roundsPerGroup}
              onChange={e => updateSettings({ roundsPerGroup: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              style={{ flex:'1 1 120px', minWidth:0 }}
            />
          </label>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Outbid landlord' : '可抢地主'}
                <input
                  type="checkbox"
                  checked={bid}
                  onChange={e => updateSettings({ bid: e.target.checked })}
                />
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Farmer cooperation' : '农民配合'}
                <input
                  type="checkbox"
                  checked={farmerCoop}
                  onChange={e => updateSettings({ farmerCoop: e.target.checked })}
                />
              </label>
            </div>
          </div>
          <div style={{ gridColumn:'2 / 3' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              {lang === 'en' ? 'Initial score' : '初始分'}
              <input
                type="number"
                step={10}
                value={startScore}
                onChange={e => updateSettings({ startScore: Number(e.target.value) || 0 })}
                style={{ flex:'1 1 120px', minWidth:0 }}
              />
            </label>
          </div>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Ladder / TrueSkill' : '天梯  /  TrueSkill'}
                <input
                  ref={allFileRef}
                  type="file"
                  accept="application/json"
                  style={{ display:'none' }}
                  onChange={handleAllFileUpload}
                />
                <button
                  onClick={() => allFileRef.current?.click()}
                  style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
                >{lang === 'en' ? 'Upload' : '上传'}</button>
              </label>
              <button
                onClick={() => window.dispatchEvent(new Event('ddz-all-save'))}
                style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
              >{lang === 'en' ? 'Save' : '存档'}</button>
            </div>
          </div>
          <label style={{ gridColumn:'2 / 3', display:'flex', alignItems:'center', gap:8 }}>
            {lang === 'en' ? '4-with-2 rule' : '4带2 规则'}
            <select
              value={four2}
              onChange={e => updateSettings({ four2: e.target.value as Four2Policy })}
              style={{ flex:'1 1 160px', minWidth:0 }}
            >
              <option value="both">{lang === 'en' ? 'Allowed' : '都可'}</option>
              <option value="2singles">{lang === 'en' ? 'Two singles' : '两张单牌'}</option>
              <option value="2pairs">{lang === 'en' ? 'Two pairs' : '两对'}</option>
            </select>
          </label>
          <div style={{ gridColumn:'1 / -1', fontSize:12, color:'#6b7280' }}>
            {lang === 'en'
              ? 'Applies to each elimination trio per round.'
              : '用于本轮每组三名选手的对局局数。'}
          </div>
        </div>
      </div>
      <div style={{ border:'1px dashed #d1d5db', borderRadius:10, padding:12, marginBottom:12 }}>
        <div style={{ fontWeight:700, marginBottom:4 }}>{participantsTitle}</div>
        <div style={{ fontSize:13, color:'#4b5563', marginBottom:12 }}>{participantsHint}</div>
        <div
          style={{
              display:'grid',
              gap:12,
              gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))',
              alignItems:'stretch',
            }}
          >
            {entries.map((entry, idx) => {
              const canRemove = entries.length > 3;
              return (
              <div
                key={entry.id}
                style={{
                  border:'1px solid #e5e7eb',
                  borderRadius:8,
                  padding:10,
                  display:'flex',
                  flexDirection:'column',
                  gap:8,
                  height:'100%',
                }}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                  <div style={{ fontWeight:600 }}>{participantLabel(idx)}</div>
                  <button
                    onClick={() => handleRemoveEntry(entry.id)}
                    disabled={!canRemove}
                    style={{
                      padding:'4px 8px',
                      borderRadius:6,
                      border:'1px solid #d1d5db',
                      background: canRemove ? '#fff' : '#f3f4f6',
                      color:'#1f2937',
                      cursor: canRemove ? 'pointer' : 'not-allowed',
                    }}
                  >{lang === 'en' ? 'Remove' : '移除'}</button>
                </div>
                <label style={{ display:'block' }}>
                  {lang === 'en' ? 'Select' : '选择'}
                  <select
                    value={entry.choice}
                    onChange={e => handleEntryChoiceChange(entry.id, e.target.value as BotChoice)}
                    style={{ width:'100%', marginTop:4 }}
                  >
                    <optgroup label={lang === 'en' ? 'Built-in' : '内置'}>
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                      <option value="built-in:advanced-hybrid">Advanced Hybrid</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'AI / External' : 'AI / 外置'}>
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'Human' : '人类选手'}>
                      <option value="human">{humanOptionLabel}</option>
                    </optgroup>
                  </select>
                </label>
                {entry.choice.startsWith('ai:') && (
                  <label style={{ display:'block' }}>
                    {lang === 'en' ? 'Model (optional)' : '模型（可选）'}
                    <input
                      type="text"
                      value={entry.model}
                      placeholder={defaultModelFor(entry.choice)}
                      onChange={e => handleEntryModelChange(entry.id, e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                    <div style={{ fontSize:12, color:'#777', marginTop:4 }}>
                      {lang === 'en'
                        ? `Leave blank to use ${defaultModelFor(entry.choice)}.`
                        : `留空则使用推荐：${defaultModelFor(entry.choice)}`}
                    </div>
                  </label>
                )}

                {entry.choice === 'ai:openai' && (
                  <label style={{ display:'block' }}>
                    OpenAI API Key
                    <input
                      type="password"
                      value={entry.keys?.openai || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'openai', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:gemini' && (
                  <label style={{ display:'block' }}>
                    Gemini API Key
                    <input
                      type="password"
                      value={entry.keys?.gemini || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'gemini', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:grok' && (
                  <label style={{ display:'block' }}>
                    xAI (Grok) API Key
                    <input
                      type="password"
                      value={entry.keys?.grok || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'grok', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:kimi' && (
                  <label style={{ display:'block' }}>
                    Kimi API Key
                    <input
                      type="password"
                      value={entry.keys?.kimi || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'kimi', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:qwen' && (
                  <label style={{ display:'block' }}>
                    Qwen API Key
                    <input
                      type="password"
                      value={entry.keys?.qwen || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'qwen', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:deepseek' && (
                  <label style={{ display:'block' }}>
                    DeepSeek API Key
                    <input
                      type="password"
                      value={entry.keys?.deepseek || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'deepseek', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'http' && (
                  <>
                    <label style={{ display:'block' }}>
                      HTTP Base / URL
                      <input
                        type="text"
                        value={entry.keys?.httpBase || ''}
                        onChange={e => handleEntryKeyChange(entry.id, 'httpBase', e.target.value)}
                        style={{ width:'100%', marginTop:4 }}
                      />
                    </label>
                    <label style={{ display:'block' }}>
                      HTTP Token（可选）
                      <input
                        type="password"
                        value={entry.keys?.httpToken || ''}
                        onChange={e => handleEntryKeyChange(entry.id, 'httpToken', e.target.value)}
                        style={{ width:'100%', marginTop:4 }}
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={handleAddEntry}
          style={{ marginTop:12, padding:'6px 12px', borderRadius:8, border:'1px solid #d1d5db', background:'#f9fafb', cursor:'pointer' }}
        >{lang === 'en' ? 'Add participant' : '新增参赛者'}</button>
      </div>

      <div style={{ marginTop:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{lang === 'en' ? 'Min play interval per participant (ms)' : '每位参赛者出牌最小间隔 (ms)'}</div>
        <div
          style={{
            display:'grid',
            gap:12,
            gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
            alignItems:'stretch',
          }}
        >
          {entries.map((entry, idx) => (
            <div key={`${entry.id}-delay`} style={{ border:'1px dashed #e5e7eb', borderRadius:6, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>{participantLabel(idx)}</div>
              <label style={{ display:'block' }}>
                {intervalTitle}
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={entry.delayMs}
                  onChange={e => handleEntryDelayChange(entry.id, e.target.value)}
                  style={{ width:'100%', marginTop:4 }}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{lang === 'en' ? 'Think timeout per participant (s)' : '每位参赛者思考超时（秒）'}</div>
        <div
          style={{
            display:'grid',
            gap:12,
            gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
            alignItems:'stretch',
          }}
        >
          {entries.map((entry, idx) => (
            <div key={`${entry.id}-timeout`} style={{ border:'1px dashed #e5e7eb', borderRadius:6, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>{participantLabel(idx)}</div>
              <label style={{ display:'block' }}>
                {timeoutTitle}
                <input
                  type="number"
                  min={5}
                  step={1}
                  value={entry.timeoutSecs}
                  onChange={e => handleEntryTimeoutChange(entry.id, e.target.value)}
                  style={{ width:'100%', marginTop:4 }}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:16 }}>
        <button
          onClick={handleGenerate}
          disabled={!enabled}
          style={{
            padding:'6px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: enabled ? '#2563eb' : '#9ca3af',
            color:'#fff',
            cursor: enabled ? 'pointer' : 'not-allowed',
          }}
        >{lang === 'en' ? 'Generate bracket' : '生成对阵'}</button>
        <button
          onClick={handleReset}
          disabled={!enabled || !rounds.length}
          style={{
            padding:'6px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: rounds.length && enabled ? '#fff' : '#f3f4f6',
            color:'#1f2937',
            cursor: rounds.length && enabled ? 'pointer' : 'not-allowed',
          }}
        >{lang === 'en' ? 'Reset bracket' : '重置对阵'}</button>
      </div>
      {error && (
        <div style={{ marginTop:8, color:'#dc2626', fontSize:13 }}>{error}</div>
      )}
      {notice && !error && (
        <div style={{ marginTop:8, color:'#2563eb', fontSize:13 }}>{notice}</div>
      )}

      <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:12, marginTop:16 }}>
        <LadderPanel />
      </div>

      {rounds.length > 0 && (
        <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:12 }}>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ fontWeight:700 }}>
                {currentRoundNumber
                  ? (lang === 'en' ? `Current round: Round ${currentRoundNumber}` : `当前轮次：第 ${currentRoundNumber} 轮`)
                  : (lang === 'en' ? 'No pending rounds.' : '暂无待运行轮次。')}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {(() => {
                  const startDisabled = !enabled || liveRunning || automationActive || !hasPendingMatch;
                  return (
                    <button
                      onClick={handleStartRound}
                      disabled={startDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: startDisabled ? '#f3f4f6' : '#2563eb',
                        color: startDisabled ? '#9ca3af' : '#fff',
                        cursor: startDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{lang === 'en' ? 'Start' : '开始'}</button>
                  );
                })()}
                {(() => {
                  const pauseDisabled = !liveRunning;
                  return (
                    <button
                      onClick={handlePauseRound}
                      disabled={pauseDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: pauseDisabled ? '#f3f4f6' : (livePaused ? '#bfdbfe' : '#fde68a'),
                        color: pauseDisabled ? '#9ca3af' : (livePaused ? '#1e3a8a' : '#92400e'),
                        cursor: pauseDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{livePaused ? (lang === 'en' ? 'Resume' : '继续') : (lang === 'en' ? 'Pause' : '暂停')}</button>
                  );
                })()}
                {(() => {
                  const stopDisabled = !liveRunning && !automationActive;
                  return (
                    <button
                      onClick={handleStopRound}
                      disabled={stopDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: stopDisabled ? '#f3f4f6' : '#fee2e2',
                        color: stopDisabled ? '#9ca3af' : '#b91c1c',
                        cursor: stopDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{lang === 'en' ? 'Stop' : '停止'}</button>
                  );
                })()}
              </div>
            </div>
            <div style={{ marginTop:12, display:'grid', gap:12 }}>
              {rounds.map((round, ridx) => (
                <div key={`round-${ridx}`} style={{ border:'1px dashed #d1d5db', borderRadius:10, padding:12 }}>
                  <div style={{ fontWeight:700, marginBottom:6 }}>
                    {lang === 'en' ? `Round ${ridx + 1}` : `第 ${ridx + 1} 轮`}
                  </div>
                  <div style={{ fontSize:13, color:'#4b5563', marginBottom:8 }}>
                    {lang === 'en'
                      ? `Each trio plays ${roundsPerGroup} game(s) this round.`
                      : `本轮每组三人进行 ${roundsPerGroup} 局。`}
                  </div>
                  <div style={{ display:'grid', gap:10 }}>
                    {round.matches.map((match, midx) => {
                      const actionable = match.players.filter(p => p && p !== KO_BYE) as string[];
                      const eliminatedLabel = match.eliminated ? displayName(match.eliminated) : null;
                      const survivors = match.eliminated
                        ? match.players.filter(p => p && p !== match.eliminated && p !== KO_BYE)
                        : [];
                      const isActiveMatch = currentMatch?.roundIdx === ridx && currentMatch?.matchIdx === midx;
                      const cardBorder = isActiveMatch ? '#2563eb' : '#e5e7eb';
                      const cardBackground = isActiveMatch ? '#f0f9ff' : '#fff';
                      const manualDisabled = automationActive || liveRunning;
                      const isFinalMatchCard = isFinalRoundMatch(rounds, ridx, midx);
                      const finalStatusNodes = isFinalMatchCard
                        ? (() => {
                            const placements = match.players
                              .filter((playerToken): playerToken is string => typeof playerToken === 'string')
                              .map(playerToken => {
                                const placement = finalPlacementLookup.get(playerToken);
                                return placement ? { playerToken, placement } : null;
                              })
                              .filter((entry): entry is { playerToken: string; placement: { rank: number; total: number | null } } => !!entry)
                              .sort((a, b) => a.placement.rank - b.placement.rank);
                            return placements.map(({ playerToken, placement }) => {
                              const labelText = placement.rank === 0
                                ? (lang === 'en' ? 'Champion' : '冠军')
                                : placement.rank === 1
                                  ? (lang === 'en' ? 'Runner-up' : '亚军')
                                  : (lang === 'en' ? 'Third place' : '季军');
                              const baseText = lang === 'en'
                                ? `${labelText}: ${podiumDisplayName(playerToken)}`
                                : `${labelText}：${podiumDisplayName(playerToken)}`;
                              const scoreText = placement.total != null
                                ? (lang === 'en'
                                  ? ` (Points: ${placement.total})`
                                  : `（积分：${placement.total}）`)
                                : '';
                              return (
                                <span
                                  key={`${match.id || `match-${midx}`}-final-${playerToken}`}
                                  style={{ fontSize:12, color:'#047857', fontWeight:600 }}
                                >
                                  {baseText}{scoreText}
                                </span>
                              );
                            });
                          })()
                        : [];
                      return (
                        <div
                          key={match.id || `round-${ridx}-match-${midx}`}
                          style={{
                            border:`1px solid ${cardBorder}`,
                            borderRadius:8,
                            padding:10,
                            background: cardBackground,
                          }}
                        >
                          <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:8 }}>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                              {match.players.map((playerToken, pidx) => {
                                const meta = playerMeta(playerToken);
                                const eliminated = match.eliminated === playerToken || playerToken === KO_BYE;
                                const labelColor = eliminated ? '#9ca3af' : '#1f2937';
                                return (
                                  <div key={`${match.id || `match-${midx}`}-player-${pidx}`} style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2 }}>
                                      <span style={{ fontWeight:700, fontSize:16, color: labelColor, opacity: eliminated ? 0.7 : 1 }}>
                                        {meta.label}
                                      </span>
                                    </div>
                                    {pidx < match.players.length - 1 && <span style={{ color:'#6b7280', fontSize:14 }}>vs</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                              {finalStatusNodes.length > 0 ? (
                                finalStatusNodes
                              ) : (
                                <>
                                  {eliminatedLabel && (
                                    <span style={{ fontSize:12, color:'#b91c1c' }}>
                                      {lang === 'en' ? `Eliminated: ${eliminatedLabel}` : `淘汰：${eliminatedLabel}`}
                                    </span>
                                  )}
                                  {match.eliminated && survivors.length > 0 && (
                                    <span style={{ fontSize:12, color:'#047857' }}>
                                      {lang === 'en'
                                        ? `Advancing: ${survivors.map(p => displayName(p)).join(', ')}`
                                        : `晋级：${survivors.map(p => displayName(p)).join('，')}`}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {actionable.length ? (
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                              {actionable.map(player => {
                                const isActive = match.eliminated === player;
                                const disabled = manualDisabled;
                                return (
                                  <button
                                    key={player}
                                    onClick={() => handleToggleEliminated(ridx, midx, player)}
                                    disabled={disabled}
                                    style={{
                                      padding:'4px 10px',
                                      borderRadius:8,
                                      border:'1px solid #d1d5db',
                                      background: isActive ? '#dc2626' : disabled ? '#f3f4f6' : '#fff',
                                      color: isActive ? '#fff' : disabled ? '#9ca3af' : '#1f2937',
                                      cursor: disabled ? 'not-allowed' : 'pointer',
                                    }}
                                  >{lang === 'en' ? `Eliminate ${displayName(player)}` : `淘汰 ${displayName(player)}`}</button>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ fontSize:12, color:'#6b7280' }}>
                              {lang === 'en' ? 'Waiting for previous results.' : '等待上一轮结果。'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>
              {lang === 'en' ? 'Live trio monitor' : '实时对局面板'}
            </div>
            {currentMatch ? (
              <>
                <div style={{ fontSize:13, color:'#4b5563', marginBottom:8 }}>
                  {currentMatch.tokens.map((token, idx) => (
                    <span key={`${token}-label`}>
                      {displayName(token)}{idx < currentMatch.tokens.length - 1 ? ' vs ' : ''}
                    </span>
                  ))}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:12 }}>
                  {currentMatch.tokens.map((token, idx) => {
                    const label = currentMatch.labels[idx] || displayName(token);
                    const total = scoreboardTotals ? scoreboardTotals[idx] : null;
                    const seatChoice = currentMatch.seats[idx];
                    const model = (currentMatch.seatModels[idx] || '').trim();
                    const httpBase = typeof currentMatch.seatKeys[idx]?.httpBase === 'string'
                      ? currentMatch.seatKeys[idx]!.httpBase!.trim()
                      : '';
                    const providerText = seatChoice === 'human'
                      ? humanProviderLabel
                      : providerSummary(seatChoice, model, httpBase, lang);
                    return (
                      <div key={`${token}-score`} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:10, background:'#fff' }}>
                        <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
                        <div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>{providerText}</div>
                        <div style={{ fontSize:24, fontWeight:800, color:'#111827' }}>{total != null ? total : '—'}</div>
                      </div>
                    );
                  })}
                </div>
                {overtimeCount > 0 && (
                  <div style={{ fontSize:12, color:'#b91c1c', marginBottom:12 }}>
                    {overtimeReason === 'final'
                      ? (lang === 'en'
                        ? `Final round overtime #${overtimeCount} (3 games) is running to break the tie.`
                        : `决赛积分出现平局，正在进行第 ${overtimeCount} 次加时赛（每次 3 局）。`)
                      : (lang === 'en'
                        ? `Overtime playoff #${overtimeCount} (3 games) is running because of a lowest-score tie.`
                        : `由于积分最低出现平局，正在进行第 ${overtimeCount} 次加时赛（每次 3 局）。`)}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize:13, color:'#6b7280', marginBottom:12 }}>
                {lang === 'en' ? 'Click “Start” to run the next trio.' : '点击“开始”运行下一组三人对局。'}
              </div>
            )}
            <div>
              <LivePanel
                key={matchKey}
                ref={livePanelRef}
                instanceId={matchKey}
                rounds={seriesRounds}
                startScore={startScore}
                seatDelayMs={delaysForLive}
                enabled={enabled && !!currentMatch}
                bid={bid}
                four2={four2}
                seats={seatsForLive}
                seatModels={modelsForLive}
                seatKeys={keysForLive}
                farmerCoop={farmerCoop}
                onLog={setMatchLog}
                onTotals={setLiveTotals}
                onRunningChange={setLiveRunning}
                onPauseChange={setLivePaused}
                onFinished={handleLiveFinished}
                controlsHidden
                initialTotals={initialTotalsForLive}
                turnTimeoutSecs={timeoutsForLive}
              />
            </div>
          </div>
        </div>
      )}

      {podiumPlacements.length ? (
        <div style={{
          marginTop:16,
          padding:12,
          border:'1px solid #bbf7d0',
          background:'#ecfdf5',
          borderRadius:10,
          color:'#047857',
        }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>
            {lang === 'en' ? 'Final standings' : '最终排名'}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {podiumPlacements.map((placement, idx) => {
              const label = idx === 0
                ? (lang === 'en' ? 'Champion' : '冠军')
                : idx === 1
                  ? (lang === 'en' ? 'Runner-up' : '亚军')
                  : (lang === 'en' ? 'Third place' : '季军');
              const score = typeof placement.total === 'number'
                ? placement.total
                : '';
              return (
                <div
                  key={`${placement.token || 'placement'}-${idx}`}
                  style={{
                    display:'flex',
                    flexWrap:'wrap',
                    gap:8,
                    fontWeight:700,
                    fontSize:24,
                  }}
                >
                  <span>{`${label}：${displayName(placement.token)}`}</span>
                  {score !== '' && (
                    <span style={{ fontSize:22, color:'#047857cc' }}>
                      {lang === 'en' ? `(Points: ${score})` : `（积分：${score}）`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function Section({ title, children }:{title:string; children:React.ReactNode}) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ====== 模型预设/校验 ====== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai': return 'gpt-4o-mini';
    case 'ai:gemini': return 'gemini-1.5-flash';
    case 'ai:grok':  return 'grok-2-latest';
    case 'ai:kimi':  return 'kimi-k2-0905-preview';
    case 'ai:qwen':  return 'qwen-plus';
    case 'ai:deepseek': return 'deepseek-chat';
    default: return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim(); if (!m) return '';
  const low = m.toLowerCase();
  switch (choice) {
    case 'ai:kimi':   return /^kimi[-\w]*/.test(low) ? m : '';
    case 'ai:openai': return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini': return /^gemini[-\w.]*/.test(low) ? m : '';
    case 'ai:grok':   return /^grok[-\w.]*/.test(low) ? m : '';
    case 'ai:qwen':   return /^qwen[-\w.]*/.test(low) ? m : '';
    case 'ai:deepseek': return /^deepseek[-\w.]*/.test(low) ? m : '';
    default: return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max':   return 'Greedy Max';
    case 'built-in:greedy-min':   return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'built-in:mininet':      return 'MiniNet';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'built-in:advanced-hybrid': return 'Advanced Hybrid';
    case 'ai:openai':             return 'OpenAI';
    case 'ai:gemini':             return 'Gemini';
    case 'ai:grok':               return 'Grok';
    case 'ai:kimi':               return 'Kimi';
    case 'ai:qwen':               return 'Qwen';
    case 'ai:deepseek':           return 'DeepSeek';
    case 'http':                  return 'HTTP';
    case 'human':                 return 'Human';
    default: return String(choice);
  }
}

function providerSummary(choice: BotChoice, model: string | undefined, httpBase: string | undefined, lang: Lang = 'zh'): string {
  const provider = choiceLabel(choice);
  if (choice === 'http') {
    const base = (httpBase || '').trim();
    if (!base) return provider;
    const customLabel = lang === 'en' ? 'custom' : '自定义';
    return `${provider} · ${customLabel}`;
  }
  if (choice.startsWith('ai:')) {
    const trimmedModel = (model || '').trim();
    return trimmedModel ? `${provider} · ${trimmedModel}` : provider;
  }
  return provider;
}
/* ====== 雷达图累计（0~5） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; bid:number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean'|'ewma', count:number, alpha:number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    return {
      coop: (prev.coop*c + curr.coop)/(c+1),
      agg:  (prev.agg *c + curr.agg )/(c+1),
      cons: (prev.cons*c + curr.cons)/(c+1),
      eff:  (prev.eff *c + curr.eff )/(c+1),
      bid: (prev.bid *c + curr.bid )/(c+1),
    };
  }
  const a = Math.min(0.95, Math.max(0.05, alpha || 0.35));
  return {
    coop: a*curr.coop + (1-a)*prev.coop,
    agg:  a*curr.agg  + (1-a)*prev.agg,
    cons: a*curr.cons + (1-a)*prev.cons,
    eff:  a*curr.eff  + (1-a)*prev.eff,
    bid: a*curr.bid  + (1-a)*prev.bid,
  };
}

/* Radar chart component (0~5) */
function RadarChart({ title, scores }: { title: string; scores: Score5 }) {
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.bid];
  const labels = ['配合','激进','保守','效率','抢地主'];
  const size = 180;
  const R = 70;
  const cx = size/2;
  const cy = size/2;

  const ang = (i:number)=> (-90 + i*(360/5)) * Math.PI/180;

  const ringPoints = (r:number)=> Array.from({length:5}, (_,i)=> (
    `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`
  )).join(' ');

  const valuePoints = Array.from({length:5}, (_,i)=> {
    const r = Math.max(0, Math.min(5, vals[i] ?? 0)) / 5 * R;
    return `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`;
  }).join(' ');

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', gap:8 }}>
      <div style={{ width:'100%', display:'flex', justifyContent:'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow:'visible' }}>
          {/* 环形网格 */}
          {[1,2,3,4].map(k=>{
            const r = (k/4) * R;
            return <polygon key={k} points={ringPoints(r)} fill="none" stroke="#e5e7eb"/>;
          })}
          {/* 轴线 */}
          {Array.from({length:5}, (_,i)=> (
            <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang(i))} y2={cy + R * Math.sin(ang(i))} stroke="#e5e7eb"/>
          ))}
          {/* 值多边形 */}
          <polygon points={valuePoints} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2}/>
          {/* 标签 */}
          {labels.map((lab, i)=>{
            const lx = cx + (R + 14) * Math.cos(ang(i));
            const ly = cy + (R + 14) * Math.sin(ang(i));
            return <text key={i} x={lx} y={ly} fontSize={11} textAnchor="middle" dominantBaseline="middle" fill="#374151">{lab}</text>;
          })}
        </svg>
      </div>
      <div style={{ fontSize:12, color:'#374151' }}>{title}</div>
    </div>
  );
}

type RadarPanelProps = {
  aggStats: Score5[] | null;
  aggCount: number;
  aggMode: 'mean'|'ewma';
  alpha: number;
  onChangeMode: (m: 'mean'|'ewma') => void;
  onChangeAlpha: (a: number) => void;
};

const RadarPanel = ({ aggStats, aggCount, aggMode, alpha, onChangeMode, onChangeAlpha }: RadarPanelProps) => {
  const [mode, setMode] = useState<'mean'|'ewma'>(aggMode);
  const [a, setA] = useState<number>(alpha);

  useEffect(() => { setMode(aggMode); }, [aggMode]);
  useEffect(() => { setA(alpha); }, [alpha]);

  return (
    <>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
        <label>
          汇总方式
          <select
            value={mode}
            onChange={e => {
              const v = e.target.value as ('mean'|'ewma');
              setMode(v);
              onChangeMode(v);
            }}
            style={{ marginLeft:6 }}
          >
            <option value="ewma">指数加权（推荐）</option>
            <option value="mean">简单平均</option>
          </select>
        </label>
        {mode === 'ewma' && (
          <label>
            α（0.05–0.95）
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={a}
              onChange={e => {
                const v = Math.min(0.95, Math.max(0.05, Number(e.target.value) || 0.35));
                setA(v);
                onChangeAlpha(v);
              }}
              style={{ width:80, marginLeft:6 }}
            />
          </label>
        )}
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {mode === 'ewma' ? '越大越看重最近几局' : `已累计 ${aggCount} 局`}
        </div>
      </div>

      {aggStats
        ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0, 1, 2].map(i => (
              <RadarChart key={i} title={`${['甲', '乙', '丙'][i]}（累计）`} scores={aggStats[i]} />
            ))}
          </div>
        )
        : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成累计画像）</div>
      }
    </>
  );
};

/* ---------- 文本改写：把“第 x 局”固定到本局 ---------- */
const makeRewriteRoundLabel = (n: number) => (msg: string) => {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g, `单局模式：开始第 ${n} 局（`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g,  `单局模式：开始第 ${n} 局(`);
  return out;
};

const sanitizeTotalsArray = (
  value: [number, number, number] | number[] | null | undefined,
  fallback: number,
): [number, number, number] => {
  const safe = Number.isFinite(fallback) ? fallback : 0;
  if (Array.isArray(value) && value.length === 3) {
    const mapped = value.map(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : safe;
    }) as number[];
    return [mapped[0], mapped[1], mapped[2]] as [number, number, number];
  }
  return [safe, safe, safe];
};

/* ==================== LivePanel（对局） ==================== */
const LivePanel = forwardRef<LivePanelHandle, LiveProps>(function LivePanel(props, ref) {
  const { t, lang } = useI18n();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const pauseResolversRef = useRef<Array<() => void>>([]);
  const runningRef = useRef(running);
  const instanceIdRef = useRef<number>(props.instanceId);

  useEffect(() => { instanceIdRef.current = props.instanceId; }, [props.instanceId]);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { props.onRunningChange?.(running); }, [running, props.onRunningChange]);
  useEffect(() => { props.onPauseChange?.(paused); }, [paused, props.onPauseChange]);

  const flushPauseResolvers = () => {
    const list = pauseResolversRef.current.slice();
    pauseResolversRef.current.length = 0;
    for (const fn of list) {
      try { fn(); } catch {}
    }
  };
  const enterPause = () => {
    if (pauseRef.current) return;
    pauseRef.current = true;
    setPaused(true);
  };
  const exitPause = () => {
    pauseRef.current = false;
    setPaused(false);
    flushPauseResolvers();
  };
  const waitWhilePaused = async () => {
    if (!pauseRef.current) return;
    while (pauseRef.current) {
      await new Promise<void>(resolve => {
        pauseResolversRef.current.push(resolve);
      });
    }
  };

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [bidMultiplier, setBidMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [bottomInfo, setBottomInfo] = useState<BottomInfo>({ landlord: null, cards: [], revealed: false });
  const [log, setLog] = useState<string[]>([]);
  const [deckAudit, setDeckAudit] = useState<DeckAuditReport | null>(null);
  const deckAuditRef = useRef<DeckAuditReport | null>(null);
  useEffect(() => { deckAuditRef.current = deckAudit; }, [deckAudit]);
  const [thoughtStore, setThoughtStore] = useState<ThoughtStore>(() => readThoughtStore());
  const thoughtStoreRef = useRef<ThoughtStore>(thoughtStore);
  useEffect(() => { thoughtStoreRef.current = thoughtStore; }, [thoughtStore]);
  const [lastThoughtMs, setLastThoughtMs] = useState<(number | null)[]>([null, null, null]);
  const seatIdentity = useCallback((i:number) => {
    const choice = props.seats[i] as BotChoice;
    const modelInput = Array.isArray(props.seatModels) ? props.seatModels[i] : undefined;
    const normalizedModel = normalizeModelForProvider(choice, modelInput || '') || defaultModelFor(choice);
    const base = choice === 'http' ? (props.seatKeys?.[i]?.httpBase || '') : '';
    return makeThoughtIdentity(choice, normalizedModel, base);
  }, [props.seats, props.seatModels, props.seatKeys]);
  const botCallIssuedAtRef = useRef<Record<number, number>>({});
  const humanCallIssuedAtRef = useRef<Record<number, number>>({});
  const humanActiveRequestRef = useRef<Record<number, string>>({});
  const kimiTpmRef = useRef<{ count: number; avg: number; totalTokens: number; last?: number }>({ count: 0, avg: 0, totalTokens: 0 });
  const humanTraceRef = useRef<string>('');
  const handRevealRef = useRef<[number, number, number]>([0, 0, 0]);
  const [, setHandRevealTick] = useState(0);
  const bumpHandReveal = useCallback(() => setHandRevealTick(t => t + 1), []);
  const resetHandReveal = useCallback(() => {
    handRevealRef.current = [0, 0, 0];
    bumpHandReveal();
  }, [bumpHandReveal]);
  const queueHandReveal = useCallback((seatList: number[], durationMs: number) => {
    const seats = seatList
      .map(seat => Number(seat))
      .filter(seat => Number.isInteger(seat) && seat >= 0 && seat < 3);
    if (!seats.length) return;
    const rawDuration = Number(durationMs);
    const duration = Math.max(0, Number.isFinite(rawDuration) ? Math.floor(rawDuration) : 0);
    const now = Date.now();
    const next = [...handRevealRef.current] as number[];
    let changed = false;
    seats.forEach(seat => {
      const until = now + duration;
      if (next[seat] < until) {
        next[seat] = until;
        changed = true;
      }
    });
    if (changed) {
      handRevealRef.current = next as [number, number, number];
      bumpHandReveal();
    }
    const timeoutMs = duration + 25;
    setTimeout(() => {
      const snapshot = [...handRevealRef.current] as number[];
      const now2 = Date.now();
      let updated = false;
      seats.forEach(seat => {
        if (snapshot[seat] !== 0 && snapshot[seat] <= now2) {
          snapshot[seat] = 0;
          updated = true;
        }
      });
      if (updated) {
        handRevealRef.current = snapshot as [number, number, number];
        bumpHandReveal();
      }
    }, timeoutMs);
  }, [bumpHandReveal]);
  const [humanRequest, setHumanRequest] = useState<HumanPrompt | null>(null);
  const [humanSelectedIdx, setHumanSelectedIdx] = useState<number[]>([]);
  const [humanSubmitting, setHumanSubmitting] = useState(false);
  const [humanError, setHumanError] = useState<string | null>(null);
  const humanSelectedSet = useMemo(() => new Set(humanSelectedIdx), [humanSelectedIdx]);
  const humanHint = humanRequest?.hint ?? null;
  const humanHintDecorated = useMemo(() => {
    if (!humanRequest || humanRequest.phase !== 'play') return [] as string[];
    if (!humanHint || humanHint.move !== 'play' || !Array.isArray(humanHint.cards)) return [] as string[];
    if (humanHint.valid === false) return [] as string[];
    const seat = humanRequest.seat;
    if (seat == null || seat < 0 || seat >= hands.length) return [] as string[];
    const seatHand = hands[seat] || [];
    const desiredOptions = humanHint.cards.map(card => candDecorations(String(card)));
    const used = new Set<number>();
    const out: string[] = [];
    for (const options of desiredOptions) {
      let chosenIdx = -1;
      for (const opt of options) {
        const idx = seatHand.findIndex((card, i) => !used.has(i) && card === opt);
        if (idx >= 0) {
          chosenIdx = idx;
          break;
        }
      }
      if (chosenIdx < 0) {
        return [] as string[];
      }
      used.add(chosenIdx);
      out.push(seatHand[chosenIdx]);
    }
    return out;
  }, [humanRequest, humanHint, hands]);
  const humanHintMeta = useMemo(() => {
    if (!humanHint) return [] as string[];
    const items: string[] = [];
    if (humanHint.by) items.push(lang === 'en' ? `Source: ${humanHint.by}` : `来自：${humanHint.by}`);
    if (typeof humanHint.score === 'number' && Number.isFinite(humanHint.score)) {
      const scoreText = humanHint.score.toFixed(2);
      items.push(lang === 'en' ? `Estimated score ${scoreText}` : `估分：${scoreText}`);
    }
    if (humanHint.label && humanHint.move === 'play') {
      items.push(lang === 'en' ? `Pattern: ${humanHint.label}` : `牌型：${humanHint.label}`);
    }
    if (humanHint.reason) items.push(humanHint.reason);
    if (humanHint.valid === false) {
      items.push(lang === 'en'
        ? 'Warning: suggested cards were not found in the hand.'
        : '警告：提示中包含未在手牌中的牌。');
      if (humanHint.missing && humanHint.missing.length) {
        items.push((lang === 'en' ? 'Missing: ' : '缺失：') + humanHint.missing.join(lang === 'en' ? ', ' : '、'));
      }
    }
    return items;
  }, [humanHint, lang]);

  const [botTimers, setBotTimers] = useState<(BotTimer | null)[]>(() => [null, null, null]);
  const [botClockTs, setBotClockTs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    const hasActive = botTimers.some(timer => timer && timer.expiresAt > now);
    if (!hasActive) return;
    setBotClockTs(Date.now());
    const id = window.setInterval(() => {
      setBotClockTs(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [botTimers]);

  const [humanClockTs, setHumanClockTs] = useState(() => Date.now());
  const humanExpiresAt = humanRequest?.expiresAt ?? undefined;
  const humanExpired = useMemo(() => {
    if (!humanRequest) return false;
    const seat = humanRequest.seat;
    const activeId = seat != null ? humanActiveRequestRef.current[seat] : undefined;
    if (activeId && activeId !== humanRequest.requestId) return false;
    if (humanRequest.stale) return true;
    if (typeof humanExpiresAt !== 'number') return false;
    return humanClockTs >= humanExpiresAt - 100;
  }, [humanRequest, humanExpiresAt, humanClockTs]);
  const humanMsRemaining = useMemo(() => {
    if (!humanRequest) return null;
    const seat = humanRequest.seat;
    const activeId = seat != null ? humanActiveRequestRef.current[seat] : undefined;
    if (activeId && activeId !== humanRequest.requestId) return null;
    if (humanRequest.stale) return 0;
    if (typeof humanExpiresAt !== 'number') return null;
    return Math.max(0, humanExpiresAt - humanClockTs);
  }, [humanRequest, humanExpiresAt, humanClockTs]);
  const humanSecondsRemaining = useMemo(() => {
    if (humanMsRemaining == null) return null;
    return Math.max(0, Math.ceil(humanMsRemaining / 1000));
  }, [humanMsRemaining]);

  const humanLagDisplay = useMemo(() => {
    if (!humanRequest) return null;
    const lag = humanRequest.latencyMs;
    if (!Number.isFinite(lag) || lag == null) return null;
    if (lag <= 150) return null;
    const seconds = (lag / 1000).toFixed(lag >= 950 ? 0 : 1);
    return lang === 'en'
      ? `Upstream delay observed ≈${seconds}s`
      : `检测到约 ${seconds} 秒的传输延迟`;
  }, [humanRequest, lang]);

  useEffect(() => {
    if (!humanRequest) return;
    if (humanRequest.stale) return;
    if (typeof humanExpiresAt !== 'number') return;
    setHumanClockTs(Date.now());
    const interval = window.setInterval(() => {
      setHumanClockTs(Date.now());
    }, Math.min(1000, Math.max(200, humanRequest.timeoutMs || 1000)));
    return () => window.clearInterval(interval);
  }, [humanRequest, humanExpiresAt]);

  useEffect(() => {
    if (!humanRequest) return;
    if (!humanExpired) return;
    const phase = humanRequest.phase;
    let msg: string;
    if (phase === 'bid') {
      msg = lang === 'en'
        ? 'Time expired. System will pass on bidding.'
        : '已超时，默认不抢地主。';
    } else if (phase === 'double') {
      msg = lang === 'en'
        ? 'Time expired. System will skip doubling.'
        : '已超时，默认不加倍。';
    } else {
      msg = lang === 'en'
        ? 'Request expired. Waiting for auto-action or the next prompt…'
        : '请求已超时，请等待系统自动处理或下一次提示…';
    }
    setHumanError(msg);
  }, [humanExpired, humanRequest, lang]);

  const resetHumanState = useCallback(() => {
    setHumanRequest(null);
    setHumanSelectedIdx([]);
    setHumanSubmitting(false);
    setHumanError(null);
    setHumanClockTs(Date.now());
    humanCallIssuedAtRef.current = {};
    humanActiveRequestRef.current = {};
  }, []);

  const toggleHumanCard = useCallback((idx: number) => {
    setHumanSelectedIdx(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      return [...prev, idx];
    });
  }, []);

  const hasHumanSeat = useMemo(() => {
    if (!Array.isArray(props.seats)) return false;
    return props.seats.some(choice => choice === 'human');
  }, [props.seats]);

  const isHumanSeat = useCallback((seat: number) => props.seats?.[seat] === 'human', [props.seats]);

  const canDisplaySeatReason = useCallback((seat: number | null | undefined) => {
    if (!hasHumanSeat) return true;
    if (typeof seat !== 'number') return false;
    return isHumanSeat(seat);
  }, [hasHumanSeat, isHumanSeat]);

  const submitHumanAction = useCallback(async (payload: any) => {
    if (!humanRequest || humanSubmitting) return;
    const trace = humanTraceRef.current;
    if (!trace) {
      setHumanError(lang === 'en' ? 'Client trace missing' : '缺少客户端标识');
      return;
    }
    const seat = humanRequest.seat;
    const activeId = seat != null ? humanActiveRequestRef.current[seat] : undefined;
    if (activeId && activeId !== humanRequest.requestId) {
      setHumanError(lang === 'en'
        ? 'Request replaced. Please act on the latest prompt.'
        : '请求已被新的提示取代，请按照最新提示操作。');
      return;
    }
    if (humanRequest.stale) {
      setHumanError(lang === 'en'
        ? 'Request already expired. Please wait for the next prompt.'
        : '该请求已失效，请等待下一次提示。');
      return;
    }
    if (typeof humanRequest.expiresAt === 'number' && Date.now() > humanRequest.expiresAt) {
      setHumanError(lang === 'en'
        ? 'Request expired. Waiting for auto-action or the next prompt…'
        : '请求已超时，请等待系统自动处理或下一次提示…');
      if (seat != null && humanActiveRequestRef.current[seat] === humanRequest.requestId) {
        setHumanRequest(prev => (prev ? { ...prev, stale: true } : prev));
      }
      setHumanSelectedIdx([]);
      return;
    }
    setHumanSubmitting(true);
    setHumanError(null);
    try {
      const resp = await fetch('/api/human_action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientTraceId: trace,
          requestId: humanRequest.requestId,
          payload,
        }),
      });
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const data = await resp.json();
          if (data?.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }
    } catch (err:any) {
      setHumanSubmitting(false);
      const msg = err?.message || String(err);
      setHumanError(msg);
      if (/request expired/i.test(msg)) {
        const seatIdx = humanRequest?.seat;
        if (seatIdx != null && humanActiveRequestRef.current[seatIdx] === humanRequest.requestId) {
          setHumanRequest(prev => (prev ? { ...prev, stale: true } : prev));
        }
        setHumanSelectedIdx([]);
      }
    }
  }, [humanRequest, humanSubmitting, lang]);

  const handleHumanPlay = useCallback(async () => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    const ctxInfo: any = humanRequest.ctx;
    if (
      ctxInfo &&
      typeof ctxInfo.legalCount === 'number' &&
      ctxInfo.legalCount <= 0 &&
      (ctxInfo.canPass ?? true)
    ) {
      setHumanError(lang === 'en' ? 'No playable cards available. Please pass.' : '无牌可出，请选择过牌');
      return;
    }
    const seat = humanRequest.seat;
    const hand = hands[seat] || [];
    const cards = humanSelectedIdx
      .slice()
      .sort((a,b) => a - b)
      .map(idx => hand[idx])
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
    if (cards.length === 0) {
      setHumanError(lang === 'en' ? 'Select at least one card.' : '请先选择要出的牌');
      return;
    }
    await submitHumanAction({ phase:'play', move:'play', cards });
  }, [humanRequest, humanSelectedIdx, submitHumanAction, hands, lang]);

  const handleHumanPass = useCallback(async () => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    await submitHumanAction({ phase:'play', move:'pass' });
  }, [humanRequest, submitHumanAction]);

  const handleHumanBid = useCallback(async (decision: boolean) => {
    if (!humanRequest || humanRequest.phase !== 'bid') return;
    if (humanExpired) {
      setHumanError(lang === 'en'
        ? 'Time expired. Please wait for the next prompt.'
        : '操作已超时，请等待下一次提示。');
      return;
    }
    await submitHumanAction({ phase:'bid', bid: decision });
  }, [humanRequest, submitHumanAction, humanExpired, lang, setHumanError]);

  const handleHumanDouble = useCallback(async (decision: boolean) => {
    if (!humanRequest || humanRequest.phase !== 'double') return;
    if (humanExpired) {
      setHumanError(lang === 'en'
        ? 'Time expired. Please wait for the next prompt.'
        : '操作已超时，请等待下一次提示。');
      return;
    }
    await submitHumanAction({ phase:'double', double: decision });
  }, [humanRequest, submitHumanAction, humanExpired, lang, setHumanError]);

  const handleHumanClear = useCallback(() => {
    setHumanSelectedIdx([]);
    setHumanError(null);
  }, []);

  const applyHumanHint = useCallback(() => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    const hint = humanRequest.hint;
    if (!hint || hint.move !== 'play' || !Array.isArray(hint.cards)) return;
    if (hint.valid === false) {
      setHumanError(lang === 'en'
        ? 'Suggestion contains cards that are not in your hand. Please pick manually.'
        : '提示包含未在手牌中的牌，请手动选择出牌。');
      return;
    }
    const seat = humanRequest.seat;
    if (seat == null || seat < 0 || seat >= hands.length) return;
    const seatHand = hands[seat] || [];
    const desiredOptions = hint.cards.map(card => candDecorations(String(card)));
    const used = new Set<number>();
    const indices: number[] = [];
    for (const options of desiredOptions) {
      let chosenIdx = -1;
      for (const opt of options) {
        const idx = seatHand.findIndex((card, i) => !used.has(i) && card === opt);
        if (idx >= 0) {
          chosenIdx = idx;
          break;
        }
      }
      if (chosenIdx < 0) {
        setHumanError(lang === 'en'
          ? 'Suggestion could not be applied. Please choose cards manually.'
          : '无法应用建议，请手动选择要出的牌。');
        return;
      }
      used.add(chosenIdx);
      indices.push(chosenIdx);
    }
    if (indices.length > 0) {
      setHumanSelectedIdx(indices.sort((a, b) => a - b));
      setHumanError(null);
    }
  }, [humanRequest, hands, setHumanError, setHumanSelectedIdx, lang]);

  const currentHumanSeat = humanRequest?.seat ?? null;
  const humanPhase = humanRequest?.phase ?? 'play';
  const humanSeatLabel = currentHumanSeat != null ? seatName(currentHumanSeat) : '';
  const humanPhaseText = humanPhase === 'bid'
    ? (lang === 'en' ? 'Bidding' : '抢地主')
    : humanPhase === 'double'
      ? (lang === 'en' ? 'Double' : '加倍')
      : (lang === 'en' ? 'Play cards' : '出牌');

  useEffect(() => {
    const request = humanRequest;
    if (!request) return;
    if (!['bid', 'double', 'play'].includes(request.phase)) return;
    const seat = request.seat;
    if (typeof seat !== 'number' || seat < 0 || seat > 2) return;
    if (!isHumanSeat(seat)) return;
    const ctxObj: any = request.ctx || {};
    const rawHand = Array.isArray(ctxObj.hands)
      ? ctxObj.hands.map((card: any) => String(card))
      : Array.isArray(ctxObj.hand)
        ? ctxObj.hand.map((card: any) => String(card))
        : null;
    if (!rawHand || rawHand.length === 0) return;

    const usage = suitUsageRef.current;
    const ownerKey = ownerKeyForSeat(seat);
    const prevHand = Array.isArray(handsRef.current?.[seat])
      ? (handsRef.current[seat] as string[])
      : [];

    unregisterSuitUsage(usage, ownerKey, prevHand);
    const reservedBase = snapshotSuitUsage(usage, ownerKey);
    const seatPrefsSingle: SeatSuitPrefs = [];
    const preferred = extractSeatSuitPrefs(rawHand);
    seatPrefsSingle[seat] = preferred;
    const reserved = mergeReservedWithForeign(reservedBase, seat, seatPrefsSingle);
    const decorated = reconcileHandFromRaw(rawHand, prevHand, reserved, preferred);
    registerSuitUsage(usage, ownerKey, decorated);
    suitUsageRef.current = usage;

    const unchanged = decorated.length === prevHand.length
      && decorated.every((label, idx) => label === prevHand[idx]);
    if (unchanged) return;

    setHands(prev => {
      const base = Array.isArray(prev) ? [...prev] : [[], [], []];
      base[seat] = decorated;
      return base as string[][];
    });
  }, [humanRequest, isHumanSeat]);
  const humanRequireText = (() => {
    if (humanPhase !== 'play') return '';
    const req = humanRequest?.ctx?.require;
    if (!req) return lang === 'en' ? 'Any legal play' : '任意合法牌型';
    if (typeof req === 'string') return req;
    if (typeof req?.type === 'string') return req.type;
    return lang === 'en' ? 'Follow previous play' : '跟牌';
  })();
  const humanCanPass = humanPhase === 'play' ? humanRequest?.ctx?.canPass !== false : true;
  const humanLegalCount = humanPhase === 'play' && typeof (humanRequest?.ctx as any)?.legalCount === 'number'
    ? Number((humanRequest?.ctx as any).legalCount)
    : null;
  const humanMustPass = humanPhase === 'play'
    ? (((humanRequest?.ctx as any)?.mustPass === true) || (humanLegalCount === 0 && humanCanPass)) && humanCanPass
    : false;
  const humanCountdownText = useMemo(() => {
    if (humanSecondsRemaining == null) return null;
    if (humanPhase === 'bid') {
      return lang === 'en'
        ? `Time left to bid: ${humanSecondsRemaining}s`
        : `抢地主剩余时间：${humanSecondsRemaining}秒`;
    }
    if (humanPhase === 'double') {
      return lang === 'en'
        ? `Time left to decide on doubling: ${humanSecondsRemaining}s`
        : `加倍剩余时间：${humanSecondsRemaining}秒`;
    }
    if (humanPhase === 'play') {
      return lang === 'en'
        ? `Time left: ${humanSecondsRemaining}s`
        : `剩余时间：${humanSecondsRemaining}秒`;
    }
    return null;
  }, [humanSecondsRemaining, humanPhase, lang]);
  const humanExpirationNotice = useMemo(() => {
    if (!humanExpired) return null;
    if (humanPhase === 'bid') {
      return lang === 'en'
        ? 'Time expired. System will pass on bidding.'
        : '已超时，默认不抢地主。';
    }
    if (humanPhase === 'double') {
      return lang === 'en'
        ? 'Time expired. System will skip doubling.'
        : '已超时，默认不加倍。';
    }
    if (humanPhase === 'play' && !humanMustPass) {
      return lang === 'en'
        ? 'This prompt has expired. Please wait for the system to act.'
        : '该回合请求已失效，请等待系统处理。';
    }
    return null;
  }, [humanExpired, humanPhase, lang, humanMustPass]);
  const humanSelectedCount = humanSelectedIdx.length;
  const canAdoptHint = humanPhase === 'play'
    && humanHint?.move === 'play'
    && humanHint?.valid !== false
    && humanHintDecorated.length > 0;
  const initialTotals = useMemo(
    () => sanitizeTotalsArray(props.initialTotals, props.startScore || 0),
    [props.initialTotals, props.startScore],
  );
  const [totals, setTotals] = useState<[number, number, number]>(() => (
    [initialTotals[0], initialTotals[1], initialTotals[2]]
  ));
  const initialTotalsRef = useRef<[number, number, number]>(initialTotals);
  useEffect(() => {
    initialTotalsRef.current = initialTotals;
    if (!runningRef.current) {
      setTotals(prev => {
        if (
          prev[0] === initialTotals[0] &&
          prev[1] === initialTotals[1] &&
          prev[2] === initialTotals[2]
        ) {
          return prev;
        }
        return [initialTotals[0], initialTotals[1], initialTotals[2]] as [number, number, number];
      });
    }
  }, [initialTotals]);
  const [finishedCount, setFinishedCount] = useState(0);
  // —— 每手牌得分（动态曲线）+ 分局切割与地主 ——
  const [scoreSeries, setScoreSeries] = useState<(number|null)[][]>([[],[],[]]);
  const scoreSeriesRef = useRef(scoreSeries); useEffect(()=>{ scoreSeriesRef.current = scoreSeries; }, [scoreSeries]);
  const [scoreBreaks, setScoreBreaks] = useState<number[]>([]);
  const scoreBreaksRef = useRef(scoreBreaks); useEffect(()=>{ scoreBreaksRef.current = scoreBreaks; }, [scoreBreaks]);
  const [roundCuts, setRoundCuts] = useState<number[]>([0]);
  const roundCutsRef = useRef(roundCuts); useEffect(()=>{ roundCutsRef.current = roundCuts; }, [roundCuts]);

  const [roundLords, setRoundLords] = useState<number[]>([]);

  /* ====== 评分统计（每局） ====== */
  type SeatStat = { rounds:number; overallAvg:number; lastAvg:number; best:number; worst:number; mean:number; sigma:number };
  const [scoreStats, setScoreStats] = useState<SeatStat[]>([
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
  ]);
  const [scoreDists, setScoreDists] = useState<number[][]>([[],[],[]]);
  const statsFileRef = useRef<HTMLInputElement|null>(null);
  const roundLordsRef = useRef(roundLords); useEffect(()=>{ roundLordsRef.current = roundLords; }, [roundLords]);
  const bottomRef = useRef(bottomInfo); useEffect(()=>{ bottomRef.current = bottomInfo; }, [bottomInfo]);

  // 依据 scoreSeries（每手评分）与 roundCuts（每局切点）计算每局均值，并汇总到席位统计
  const recomputeScoreStats = () => {
    try {
      const series = scoreSeriesRef.current;   // number[][]
      const cuts = roundCutsRef.current;       // number[]
      const n = Math.max(series[0]?.length||0, series[1]?.length||0, series[2]?.length||0);
      const bands = (cuts && cuts.length ? [...cuts] : [0]).sort((a,b)=>a-b);
      if (bands[0] !== 0) bands.unshift(0);
      if (bands[bands.length-1] !== n) bands.push(n);
      const perSeatRounds:number[][] = [[],[],[]];
      for (let b=0;b<bands.length-1;b++){
        const st = bands[b], ed = bands[b+1];
        const len = Math.max(0, ed - st);
        if (len <= 0) continue;
        for (let s=0;s<3;s++){
          const arr = series[s]||[];
          let sum = 0, cnt = 0;
          for (let i=st;i<ed;i++){
            const v = arr[i];
            if (typeof v === 'number' && Number.isFinite(v)) { sum += v; cnt++; }
          }
          if (cnt>0) perSeatRounds[s].push(sum/cnt);
        }
      }
      const stats = [0,1,2].map(s=>{
        const rs = perSeatRounds[s];
        const rounds = rs.length;
        if (rounds===0) return { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
        const overall = rs.reduce((a,b)=>a+b,0) / rounds;
        const last = rs[rounds - 1];
        const best = Math.max(...rs);
        const worst = Math.min(...rs);
        const mu = overall;
        const sigma = Math.sqrt(Math.max(0, rs.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / rounds));
        return { rounds, overallAvg: overall, lastAvg: last, best, worst, mean: mu, sigma };
      });
      setScoreStats(stats);
      setScoreDists(perSeatRounds.map(rs => rs.slice()));
    } catch (e) { console.error('[stats] recompute error', e); }
  }
  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  const recordThought = useCallback((seat:number, ms:number, appendLog?: (line:string) => void) => {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (!(seat === 0 || seat === 1 || seat === 2)) return;
    const identity = seatIdentity(seat);
    if (!identity) return;
    const baseStore = thoughtStoreRef.current ? ensureThoughtStore(thoughtStoreRef.current) : THOUGHT_EMPTY;
    const prevPlayers = { ...(baseStore.players || {}) };
    const sanitizedPrev = ensurePlayerStats(prevPlayers[identity]);
    const prevCount = Math.max(0, Number(sanitizedPrev.count) || 0);
    const prevMean = Number(sanitizedPrev.mean) || 0;
    const nextCount = prevCount + 1;
    const nextMean = (prevMean * prevCount + ms) / nextCount;
    const displayLabel = sanitizedPrev.label && sanitizedPrev.label.trim() ? sanitizedPrev.label.trim() : thoughtLabelForIdentity(identity);
    prevPlayers[identity] = {
      mean: nextMean,
      count: nextCount,
      ...(displayLabel ? { label: displayLabel } : {}),
    };
    const nextStore: ThoughtStore = {
      schema: 'ddz-latency@3',
      updatedAt: new Date().toISOString(),
      players: prevPlayers,
    };
    const persisted = writeThoughtStore(nextStore);
    thoughtStoreRef.current = persisted;
    setThoughtStore(persisted);
    setLastThoughtMs(prevArr => {
      const arr = Array.isArray(prevArr) ? [...prevArr] : [null, null, null];
      arr[seat] = ms;
      return arr;
    });
    const fmt = (v:number) => (v >= 1000 ? v.toFixed(0) : v.toFixed(1));
    const seatDisplay = seatLabel(seat, lang);
    const stats = persisted.players?.[identity];
    const avgLabel = stats ? fmt(Number(stats.mean) || 0) : fmt(nextMean);
    const countValue = stats ? Number(stats.count) || nextCount : nextCount;
    const identityLabel = displayLabel || thoughtLabelForIdentity(identity);
    const logLine = lang === 'en'
      ? `【Latency】${identityLabel}｜${seatDisplay}｜thought=${fmt(ms)}ms｜avg=${avgLabel}ms｜n=${countValue}`
      : `【Latency】${identityLabel}｜${seatDisplay}｜思考=${fmt(ms)}ms｜均值=${avgLabel}ms｜次数=${countValue}`;
    if (appendLog) appendLog(logLine);
    else setLog(l => [...l, logLine]);
  }, [lang, seatIdentity, setLog]);

  const seatIdentitiesMemo = useMemo(() => [0,1,2].map(seatIdentity), [seatIdentity]);
  const seatDisplayNames = useMemo(
    () => seatIdentitiesMemo.map(id => (id ? thoughtLabelForIdentity(id) : '')),
    [seatIdentitiesMemo],
  );

  // —— TrueSkill（前端实时） —— //
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=> (r.mu - 3*r.sigma);

  // ===== 新增：TS 存档（读/写/应用） =====
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try { tsStoreRef.current = readStore(); } catch {} }, []);
  const fileRef = useRef<HTMLInputElement|null>(null);

  const resolveRatingForIdentity = (id: string, role?: TsRole): Rating | null => {
    const p = tsStoreRef.current.players[id]; if (!p) return null;
    if (role && p.roles?.[role]) return ensureRating(p.roles[role]);
    if (p.overall) return ensureRating(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) return { mu:(L.mu+F.mu)/2, sigma:(L.sigma+F.sigma)/2 };
    if (L) return ensureRating(L);
    if (F) return ensureRating(F);
    return null;
  };

  const applyTsFromStore = (why:string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = ids.map(id => resolveRatingForIdentity(id) || { ...TS_DEFAULT });
    setTsArr(init);
    setLog(l => [...l, `【TS】已从存档应用（${why}）：` + init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')]);
  };

  // NEW: 按角色应用（若知道地主，则地主用 landlord 档，其他用 farmer 档；未知则退回 overall）
  const applyTsFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = [0,1,2].map(i => {
      const role: TsRole | undefined = (lord == null) ? undefined : (i === lord ? 'landlord' : 'farmer');
      return resolveRatingForIdentity(ids[i], role) || { ...TS_DEFAULT };
    });
    setTsArr(init);
    setLog(l => [...l,
      `【TS】按角色应用（${why}，地主=${lord ?? '未知'}）：` +
      init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')
    ]);
  };

  const updateStoreAfterRound = (updated: Rating[], landlordIndex:number) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...updated[i] };
      const role: TsRole = (i===landlordIndex) ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      entry.roles[role] = { ...updated[i] };
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      tsStoreRef.current.players[id] = entry;
    }
    writeStore(tsStoreRef.current);
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: TsStore = emptyStore();

      // 兼容多种模板：数组 / {players:{}} / 单人
      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall || p.rating || null,
            roles: { landlord: p.roles?.landlord ?? p.landlord ?? p.L ?? null,
                     farmer:   p.roles?.farmer   ?? p.farmer   ?? p.F ?? null },
            meta: p.meta || {}
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        store.players = j.players;
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p; }
      } else {
        if (j?.id) store.players[j.id] = j;
      }

      tsStoreRef.current = store; writeStore(store);
      setLog(l => [...l, `【TS】已上传存档（共 ${Object.keys(store.players).length} 名玩家）`]);
    } catch (err:any) {
      setLog(l => [...l, `【TS】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  const makeArchiveName = (suffix: string) => {
    const d = new Date();
    const pad = (n:number) => String(n).padStart(2, '0');
    const tag = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `ddz_all_stats_${tag}${suffix}`;
  };

  const handleSaveArchive = () => {
    const ids = [0,1,2].map(seatIdentity);
    ids.forEach((id,i)=>{
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...tsRef.current[i] };
      tsStoreRef.current.players[id] = entry;
    });
    writeStore(tsStoreRef.current);
    const blob = new Blob([JSON.stringify(tsStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = makeArchiveName('_trueskill.json'); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  // —— 用于“区分显示”的帮助函数 —— //
  const fmt2 = (x:number)=> (Math.round(x*100)/100).toFixed(2);
  const muSig = (r: Rating | null | undefined) => r ? `μ ${fmt2(r.mu)}｜σ ${fmt2(r.sigma)}` : '—';
  const getStoredForSeat = (i:number) => {
    const id = seatIdentity(i);
    const p = tsStoreRef.current.players[id];
    return {
      overall: p?.overall ? ensureRating(p.overall) : null,
      landlord: p?.roles?.landlord ? ensureRating(p.roles.landlord) : null,
      farmer: p?.roles?.farmer ? ensureRating(p.roles.farmer) : null,
    };
  };
  /* ===== Radar（战术画像）本地存档（新增） ===== */
  type RadarAgg = { scores: Score5; count: number };
  type RadarStoreEntry = {
    id: string; // 身份：choice|model|base（沿用 seatIdentity）
    overall?: RadarAgg | null;  // 不区分身份时累计
    roles?: { landlord?: RadarAgg | null; farmer?: RadarAgg | null }; // 按角色分档
    meta?: { choice?: string; model?: string; httpBase?: string };
  };
  type RadarStore = {
    schema: 'ddz-radar@1';
    updatedAt: string;
    players: Record<string, RadarStoreEntry>;
  };
  const RADAR_STORE_KEY = 'ddz_radar_store_v1';

  const ensureScore5 = (x:any): Score5 => ({
    coop: Number(x?.coop ?? 2.5),
    agg : Number(x?.agg  ?? 2.5),
    cons: Number(x?.cons ?? 2.5),
    eff : Number(x?.eff  ?? 2.5),
    bid : Number(x?.bid ?? 2.5),
  });
  const ensureRadarAgg = (x:any): RadarAgg => ({
    scores: ensureScore5(x?.scores),
    count : Math.max(0, Number(x?.count)||0),
  });

  const emptyRadarStore = (): RadarStore =>
    ({ schema:'ddz-radar@1', updatedAt:new Date().toISOString(), players:{} });

  const readRadarStore = (): RadarStore => {
    try {
      const raw = localStorage.getItem(RADAR_STORE_KEY);
      if (!raw) return emptyRadarStore();
      const j = JSON.parse(raw);
      if (j?.schema === 'ddz-radar@1' && j?.players) return j as RadarStore;
    } catch {}
    return emptyRadarStore();
  };
  const writeRadarStore = (_s: RadarStore) => { /* no-op: radar not persisted */ };

  /** 用“均值 + 次数”合并（与前端 mean 聚合一致） */
  function mergeRadarAgg(prev: RadarAgg|null|undefined, inc: Score5): RadarAgg {
    if (!prev) return { scores: { ...inc }, count: 1 };
    const c = prev.count;
    const mean = (a:number,b:number)=> (a*c + b)/(c+1);
    return {
      scores: {
        coop: mean(prev.scores.coop, inc.coop),
        agg : mean(prev.scores.agg , inc.agg ),
        cons: mean(prev.scores.cons, inc.cons),
        eff : mean(prev.scores.eff , inc.eff ),
        bid : mean(prev.scores.bid, inc.bid),
      },
      count: c + 1,
    };
  }

  // —— Radar 存档：读写/应用/上传/导出 —— //
  const radarStoreRef = useRef<RadarStore>(emptyRadarStore());
  useEffect(()=>{ try { radarStoreRef.current = readRadarStore(); } catch {} }, []);
  const radarFileRef = useRef<HTMLInputElement|null>(null);

  /** 取指定座位的（按角色可选）Radar 累计 */
  const resolveRadarForIdentity = (id:string, role?: 'landlord'|'farmer'): RadarAgg | null => {
    const p = radarStoreRef.current.players[id];
    if (!p) return null;
    if (role && p.roles?.[role]) return ensureRadarAgg(p.roles[role]);
    if (p.overall) return ensureRadarAgg(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) {
      const ll = ensureRadarAgg(L), ff = ensureRadarAgg(F);
      const tot = Math.max(1, ll.count + ff.count);
      const w = (a:number,b:number,ca:number,cb:number)=> (a*ca + b*cb)/tot;
      return {
        scores: {
          coop: w(ll.scores.coop, ff.scores.coop, ll.count, ff.count),
          agg : w(ll.scores.agg , ff.scores.agg , ll.count, ff.count),
          cons: w(ll.scores.cons, ff.scores.cons, ll.count, ff.count),
          eff : w(ll.scores.eff , ff.scores.eff , ll.count, ff.count),
          bid : w(ll.scores.bid, ff.scores.bid, ll.count, ff.count),
        },
        count: tot,
      };
    }
    if (L) return ensureRadarAgg(L);
    if (F) return ensureRadarAgg(F);
    return null;
  };

  /** 根据当前地主身份（已知/未知）把存档套到 UI 的 aggStats/aggCount */
  
  /* ===== 天梯（活动积分 ΔR_event）本地存档（localStorage 直接读写） ===== */
  type LadderAgg = { n:number; sum:number; delta:number; deltaR:number; K:number; N0:number; matches:number };
  type LadderEntry = { id:string; label:string; current:LadderAgg; history?: { when:string; n:number; delta:number; deltaR:number }[] };
  type LadderStore = { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, LadderEntry> };
  const LADDER_KEY = 'ddz_ladder_store_v1';
  const LADDER_EMPTY: LadderStore = { schema:'ddz-ladder@1', updatedAt:new Date().toISOString(), players:{} };
  const LADDER_DEFAULT: LadderAgg = { n:0, sum:0, delta:0, deltaR:0, K:20, N0:20, matches:0 };

  function readLadder(): LadderStore {
    try { const raw = localStorage.getItem(LADDER_KEY); if (raw) { const j = JSON.parse(raw); if (j?.schema==='ddz-ladder@1') return j as LadderStore; } } catch {}
    return { ...LADDER_EMPTY, updatedAt:new Date().toISOString() };
  }
  function writeLadder(s: LadderStore) {
    try { s.updatedAt = new Date().toISOString(); localStorage.setItem(LADDER_KEY, JSON.stringify(s)); } catch {}
  }
  function ladderUpdateLocal(id:string, label:string, sWin:number, pExp:number, weight:number=1, matchIncrement:number=1) {
    const st = readLadder();
    const ent = st.players[id] || { id, label, current: { ...LADDER_DEFAULT }, history: [] };
    if (!ent.current) ent.current = { ...LADDER_DEFAULT };
    if (!ent.label) ent.label = label;
    const w = Math.max(0, Number(weight) || 0);
    const matchInc = Math.max(0, Number(matchIncrement) || 0);
    ent.current.n += w;
    ent.current.sum += w * (sWin - pExp);
    const N0 = ent.current.N0 ?? 20;
    const K  = ent.current.K  ?? 20;
    if (typeof ent.current.matches !== 'number' || !Number.isFinite(ent.current.matches)) {
      const fallback = Number(ent.current.n) || 0;
      ent.current.matches = Math.max(0, Math.round(fallback));
    }
    ent.current.matches += matchInc;
    ent.current.delta = ent.current.n > 0 ? (ent.current.sum / ent.current.n) : 0;
    const shrink = Math.sqrt(ent.current.n / (ent.current.n + Math.max(1, N0)));
    ent.current.deltaR = K * ent.current.delta * shrink;
    st.players[id] = ent;
    writeLadder(st);
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  }

  const applyRadarFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const s3 = [0,1,2].map(i=>{
      const role = (lord==null) ? undefined : (i===lord ? 'landlord' : 'farmer');
      return resolveRadarForIdentity(ids[i], role) || { scores: { coop:2.5, agg:2.5, cons:2.5, eff:2.5, bid:2.5 }, count: 0 };
    });
    setAggStats(s3.map(x=>({ ...x.scores })));
    setAggCount(Math.max(s3[0].count, s3[1].count, s3[2].count));
    setLog(l => [...l, `【Radar】已从存档应用（${why}，地主=${lord ?? '未知'}）`]);
  };

  /** 在收到一帧“本局画像 s3[0..2]”后，写入 Radar 存档（overall + 角色分档） */
  const updateRadarStoreFromStats = (s3: Score5[], lord: number | null) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry = (radarStoreRef.current.players[id] || { id, roles:{} }) as RadarStoreEntry;
      entry.overall = mergeRadarAgg(entry.overall, s3[i]);
      if (lord!=null) {
        const role: 'landlord' | 'farmer' = (i===lord ? 'landlord' : 'farmer');
        entry.roles = entry.roles || {};
        entry.roles[role] = mergeRadarAgg(entry.roles[role], s3[i]);
      }
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      radarStoreRef.current.players[id] = entry;
    }
    // writeRadarStore disabled (no radar persistence)
  };

  /** 上传 Radar 存档（JSON） */
  const handleRadarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: RadarStore = emptyRadarStore();

      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : (p.landlord ? ensureRadarAgg(p.landlord) : null),
              farmer  : p.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : (p.farmer   ? ensureRadarAgg(p.farmer)   : null),
            },
            meta: p.meta || {},
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        for (const [id, p] of Object.entries<any>(j.players)) {
          store.players[id] = {
            id,
            overall: p?.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p?.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : null,
              farmer  : p?.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : null,
            },
            meta: p?.meta || {},
          };
        }
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p as any; }
      } else if (j?.id) {
        store.players[j.id] = j as any;
      }

      radarStoreRef.current = store; writeRadarStore(store);
      setLog(l => [...l, `【Radar】已上传存档（${Object.keys(store.players).length} 位）`]);
    } catch (err:any) {
      setLog(l => [...l, `【Radar】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  /** 导出当前 Radar 存档 */
  const handleRadarSave = () => {
  setLog(l => [...l, '【Radar】存档已禁用（仅支持查看/刷新，不再保存到本地或 ALL 文件）。']);
};
;

  // 累计画像
  const [aggMode, setAggMode] = useState<'mean'|'ewma'>('ewma');
  const [alpha, setAlpha] = useState<number>(0.35);
  const [aggStats, setAggStats] = useState<Score5[] | null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  const controllerRef = useRef<AbortController|null>(null);
  const handsRef = useRef(hands); useEffect(() => { handsRef.current = hands; }, [hands]);
  const playsRef = useRef(plays); useEffect(() => { playsRef.current = plays; }, [plays]);
  const totalsRef = useRef(totals); useEffect(() => { totalsRef.current = totals; }, [totals]);
  const roundBaseTotalsRef = useRef<[number, number, number] | null>(null);
  const finishedRef = useRef(finishedCount); useEffect(() => { finishedRef.current = finishedCount; }, [finishedCount]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const landlordRef = useRef(landlord); useEffect(() => { landlordRef.current = landlord; }, [landlord]);
  const winnerRef = useRef(winner); useEffect(() => { winnerRef.current = winner; }, [winner]);
  const deltaRef = useRef(delta); useEffect(() => { deltaRef.current = delta; }, [delta]);
  const multiplierRef = useRef(multiplier); useEffect(() => { multiplierRef.current = multiplier; }, [multiplier]);
  const bidMultiplierRef = useRef(bidMultiplier); useEffect(() => { bidMultiplierRef.current = bidMultiplier; }, [bidMultiplier]);

  const aggStatsRef = useRef(aggStats); useEffect(()=>{ aggStatsRef.current = aggStats; }, [aggStats]);
  const aggCountRef = useRef(aggCount); useEffect(()=>{ aggCountRef.current = aggCount; }, [aggCount]);
  const aggModeRef  = useRef(aggMode);  useEffect(()=>{ aggModeRef.current  = aggMode;  }, [aggMode]);
  const alphaRef    = useRef(alpha);    useEffect(()=>{ alphaRef.current    = alpha;    }, [alpha]);

  const lastReasonRef = useRef<(string|null)[]>([null, null, null]);
  const suitUsageRef = useRef<RankSuitUsage>(new Map());

  // 每局观测标记
  const roundFinishedRef = useRef<boolean>(false);
  const seenStatsRef     = useRef<boolean>(false);

  
  const scoreFileRef = useRef<HTMLInputElement|null>(null);

  const agentIdForIndex = (i:number) => {
    const choice = props.seats[i] as BotChoice;
    const label = choiceLabel(choice);
    if ((choice as string).startsWith('built-in') || choice === 'human') return label;
    const model = (props.seatModels?.[i]) || defaultModelFor(choice);
    return `${label}:${model}`;
  };

  const handleScoreSave = () => {
    const agents = [0,1,2].map(agentIdForIndex);
    const n = Math.max(scoreSeries[0]?.length||0, scoreSeries[1]?.length||0, scoreSeries[2]?.length||0);
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      agents,
      rounds: roundCutsRef.current,
      breaks: scoreBreaksRef.current,
      n,
      seriesBySeat: scoreSeriesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'score_series.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  };

  const handleScoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(String(rd.result||'{}'));
          const fileAgents: string[] = j.agents || (Array.isArray(j.seats)? j.seats.map((s:any)=> s.agent || s.label) : []);
          const targetAgents = [0,1,2].map(agentIdForIndex);
          const mapped:(number|null)[][] = [[],[],[]];
          for (let i=0;i<3;i++){
            const idx = fileAgents.indexOf(targetAgents[i]);
            mapped[i] = (idx>=0 && Array.isArray(j.seriesBySeat?.[idx])) ? j.seriesBySeat[idx] : [];
          }
          setScoreSeries(mapped);
          if (Array.isArray(j.breaks)) setScoreBreaks(j.breaks as number[]);
          else setScoreBreaks([]);
          if (Array.isArray(j.rounds)) setRoundCuts(j.rounds as number[]);
        } catch (err) {
          console.error('[score upload] parse error', err);
        }
      };
      rd.readAsText(f);
    } catch (err) {
      console.error('[score upload] error', err);
    } finally {
      if (scoreFileRef.current) scoreFileRef.current.value = '';
    }
  };

  
  const handleStatsSave = () => {
    try {
      const payload = { when: new Date().toISOString(), stats: scoreStats, dists: scoreDists };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'score-stats.json';
      a.click();
      setTimeout(()=> URL.revokeObjectURL(a.href), 0);
    } catch (e) { console.error('[stats] save error', e); }
  };
  const handleStatsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const obj = JSON.parse(String(rd.result||'{}'));
          if (Array.isArray(obj.stats) && obj.stats.length===3) setScoreStats(obj.stats as any);
          if (Array.isArray(obj.dists) && obj.dists.length===3) setScoreDists(obj.dists as any);
        } catch (err) { console.error('[stats upload] parse error', err); }
      };
      rd.readAsText(f);
    } catch (err) { console.error('[stats upload] error', err); }
    finally { if (statsFileRef.current) statsFileRef.current.value = ''; }
  };
  const handleStatsRefresh = () => { setRoundCuts(prev => [...prev]); };
const handleScoreRefresh = () => {
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
    setScoreBreaks(prev => [...prev]);
  };
const [allLogs, setAllLogs] = useState<string[]>([]);
const allLogsRef = useRef(allLogs);
useEffect(() => { allLogsRef.current = allLogs; }, [allLogs]);
  const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    exitPause();
    setRunning(true);
    setAllLogs([]);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    suitUsageRef.current = new Map();
    setBottomInfo({ landlord: null, cards: [], revealed: false });
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    const startTotals = totalsRef.current;
    if (Array.isArray(startTotals) && startTotals.length === 3) {
      roundBaseTotalsRef.current = [startTotals[0], startTotals[1], startTotals[2]] as [number, number, number];
    } else {
      roundBaseTotalsRef.current = null;
    }
    setBotTimers([null, null, null]);
    botCallIssuedAtRef.current = {};
    humanCallIssuedAtRef.current = {};
    humanActiveRequestRef.current = {};
    kimiTpmRef.current = { count: 0, avg: 0, totalTokens: 0, last: undefined };
    setBotClockTs(Date.now());
    const base = initialTotalsRef.current;
    setTotals([base[0], base[1], base[2]] as [number, number, number]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);
    resetHumanState();
    humanTraceRef.current = '';

    // TrueSkill：开始时先应用 overall（未知地主）
    setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
    try { applyTsFromStore('比赛开始前'); } catch {}

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai':   return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini':   return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':     return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':     return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':     return { choice, model, apiKey: keys.qwen || '' };
          case 'ai:deepseek': return { choice, model, apiKey: keys.deepseek || '' };
          case 'http':        return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:            return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs.map((s, i) => {
        const nm = seatName(i);
        if (s.choice.startsWith('built-in')) return `${nm}=${choiceLabel(s.choice as BotChoice)}`;
        if (s.choice === 'http') return `${nm}=HTTP(${s.baseUrl ? 'custom' : 'default'})`;
        return `${nm}=${choiceLabel(s.choice as BotChoice)}(${s.model || defaultModelFor(s.choice as BotChoice)})`;
      }).join(', ');

    const markRoundFinishedIfNeeded = (
      nextFinished:number,
      nextAggStats: Score5[] | null,
      nextAggCount: number
    ) => {
      if (!roundFinishedRef.current) {
        if (!seenStatsRef.current) {
          const neutral: Score5 = { coop:2.5, agg:2.5, cons:2.5, eff:2.5, bid:2.5 };
          const mode = aggModeRef.current;
          const a    = alphaRef.current;
          if (!nextAggStats) {
            nextAggStats = [neutral, neutral, neutral];
            nextAggCount = 1;
          } else {
            nextAggStats = nextAggStats.map(prev => mergeScore(prev, neutral, mode, nextAggCount, a));
            nextAggCount = nextAggCount + 1;
          }
        }
        roundFinishedRef.current = true;
        nextFinished = nextFinished + 1;
      }
      return { nextFinished, nextAggStats, nextAggCount };
    };

    const playOneGame = async (_gameIndex: number, labelRoundNo: number) => {
    let lastEventTs = Date.now();
    const timeoutMs = (()=>{
      const arr = props.turnTimeoutSecs || [30,30,30];
      const norm = arr.map(x=> (Number.isFinite(x as any) && (x as any)>0 ? (x as any) : 30));
      const sec = Math.min(...norm);
      return Math.max(5000, sec*1000);
    })();
    let dogId: any = null;

      setLog([]); lastReasonRef.current = [null, null, null];
      resetHandReveal();
      const baseSpecs = buildSeatSpecs();
      const startShift = ((labelRoundNo - 1) % 3 + 3) % 3;
      const specs = [0,1,2].map(i => baseSpecs[(i + startShift) % 3]);
      const toUiSeat = (j:number) => (j + startShift) % 3;
      const remap3 = <T,>(arr: T[]) => ([ arr[(0 - startShift + 3) % 3], arr[(1 - startShift + 3) % 3], arr[(2 - startShift + 3) % 3] ]) as T[];
      const traceId = Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);
      humanTraceRef.current = traceId;
      setLog(l => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(baseSpecs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      roundFinishedRef.current = false;
      seenStatsRef.current = false;
      const preRoundTotals = totalsRef.current;
      if (Array.isArray(preRoundTotals) && preRoundTotals.length === 3) {
        roundBaseTotalsRef.current = [preRoundTotals[0], preRoundTotals[1], preRoundTotals[2]] as [number, number, number];
      }

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          bid: props.bid,
          four2: props.four2,
          seats: specs,
          clientTraceId: traceId,
          stopBelowZero: true,
          farmerCoop: props.farmerCoop,
        turnTimeoutSec: (props.turnTimeoutSecs ?? [30,30,30])
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      dogId = setInterval(() => {
        if (Date.now() - lastEventTs > timeoutMs) {
          setLog(l => [...l, `⏳ 超过 ${Math.round(timeoutMs/1000)}s 未收到事件，已触发前端提示（后端会按规则自动“过”或出最小牌），继续等待…`]);
          lastEventTs = Date.now(); // 防止重复提示
        }
      }, 1000);
    
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewrite = makeRewriteRoundLabel(labelRoundNo);

      while (true) {
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        const batch: any[] = [];
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try { batch.push(JSON.parse(line)); } catch {}
        }

        if (batch.length) {
          let nextHands = handsRef.current.map(x => [...x]);
          let nextPlays = [...playsRef.current];
          let nextTotals = [...totalsRef.current] as [number, number, number];
          let nextFinished = finishedRef.current;
          let nextLog = [...logRef.current];
          let nextLandlord = landlordRef.current;
          let nextWinner = winnerRef.current as number | null;
          let nextDelta = deltaRef.current as [number, number, number] | null;
          let nextMultiplier = multiplierRef.current;
          let nextBidMultiplier = bidMultiplierRef.current;
          let nextAggStats = aggStatsRef.current;
          let nextAggCount = aggCountRef.current;

          let nextDeckAudit = deckAuditRef.current;
          let deckAuditChanged = false;

          const updateDeckAuditSnapshot = (handsSnapshot: string[][], bottomSnapshot: BottomInfo) => {
            const auditCandidate = computeDeckAuditSnapshot(handsSnapshot, bottomSnapshot);
            if (!auditCandidate) return;
            const prevFingerprint = nextDeckAudit?.fingerprint;
            if (!nextDeckAudit || prevFingerprint !== auditCandidate.fingerprint) {
              nextDeckAudit = auditCandidate;
              deckAuditChanged = true;
              const ownerLabel = (owner: DeckOwner) => owner.type === 'seat'
                ? seatName(owner.seat)
                : '底牌';
              const duplicateText = auditCandidate.duplicates.length
                ? auditCandidate.duplicates
                    .map(dup => `${deckKeyDisplay(dup.key)}@${dup.owners.map(ownerLabel).join('+')}`)
                    .join('；')
                : '无';
              const missingText = auditCandidate.missing.length
                ? auditCandidate.missing.map(deckKeyDisplay).join('、')
                : '无';
              nextLog = [
                ...nextLog,
                `【牌局校验】总数=${auditCandidate.total}/${auditCandidate.expectedTotal}｜重复=${duplicateText}｜缺失=${missingText}`,
              ];
            }
          };

          let nextScores = scoreSeriesRef.current.map(x => [...x]);
          let nextBreaks = scoreBreaksRef.current.slice();
          let sawAnyTurn = false;
          let nextCuts = roundCutsRef.current.slice();
          let nextLords = roundLordsRef.current.slice();
          let nextBottom = (() => {
            const cur = bottomRef.current;
            return {
              landlord: cur?.landlord ?? null,
              cards: (cur?.cards || []).map(c => ({ ...c })),
              revealed: !!cur?.revealed,
            } as BottomInfo;
          })();
          for (const raw of batch) {
            let m: any = raw;
            // Remap engine->UI indices when startShift != 0
            if (startShift) {
              const mapMsg = (obj:any)=>{
                const out:any = { ...obj };
                const mapSeat = (x:any)=> (typeof x==='number' ? toUiSeat(x) : x);
                const mapArr = (a:any)=> (Array.isArray(a) && a.length===3 ? remap3(a) : a);
                out.seat = mapSeat(out.seat);
                if ('landlordIdx' in out) out.landlordIdx = mapSeat(out.landlordIdx);
                if ('landlord' in out) out.landlord = mapSeat(out.landlord);
                if ('winner' in out) out.winner = mapSeat(out.winner);
                if ('hands' in out) out.hands = mapArr(out.hands);
                if ('totals' in out) out.totals = mapArr(out.totals);
                if ('delta' in out) out.delta = mapArr(out.delta);
                if ('ratings' in out) out.ratings = mapArr(out.ratings);
                if (out.payload) {
                  const p:any = { ...out.payload };
                  if ('seat' in p) p.seat = mapSeat(p.seat);
                  if ('landlord' in p) p.landlord = mapSeat(p.landlord);
                  if ('hands' in p) p.hands = mapArr(p.hands);
                  if ('totals' in p) p.totals = mapArr(p.totals);
                  out.payload = p;
                }
                return out;
              };
              m = mapMsg(raw);
            } else {
              const m_any:any = raw; m = m_any;
            }

            // m already defined above
            try {
              // -------- TS 帧（后端主动提供） --------
              if (m.type === 'ts' && Array.isArray(m.ratings) && m.ratings.length === 3) {
                const incoming: Rating[] = m.ratings.map((r:any)=>({ mu:Number(r.mu)||25, sigma:Number(r.sigma)||25/3 }));
                setTsArr(incoming);

                if (m.where === 'after-round') {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                  nextLog = [...nextLog, `【TS】after-round 已更新 μ/σ`];
                } else if (m.where === 'before-round') {
                  nextLog = [...nextLog, `【TS】before-round μ/σ 准备就绪`];
                }
                continue;
              }

              // -------- 事件边界 --------
              if (m.type === 'event' && m.kind === 'round-start') {
                nextBidMultiplier = 1;
                nextMultiplier = 1;
                // 清空上一局残余手牌/出牌；等待 init/hands 再填充
                nextPlays = [];
                nextHands = [[], [], []] as any;
                nextLandlord = null;
                nextBottom = { landlord: null, cards: [], revealed: false };
                if (nextDeckAudit) {
                  nextDeckAudit = null;
                  deckAuditChanged = true;
                }
                resetHumanState();
                resetHandReveal();
                suitUsageRef.current = new Map();
                roundBaseTotalsRef.current = [nextTotals[0], nextTotals[1], nextTotals[2]] as [number, number, number];

                nextLog = [...nextLog, `【边界】round-start #${m.round}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'bid-skip') {
                const reason = typeof m.reason === 'string' ? m.reason : '';
                nextLog = [...nextLog, `【抢地主】全部选择不抢，重新发牌${reason ? `｜原因=${reason}` : ''}`];
                nextBidMultiplier = 1;
                nextMultiplier = 1;
                nextPlays = [];
                nextHands = [[], [], []] as any;
                nextLandlord = null;
                nextBottom = { landlord: null, cards: [], revealed: false };
                resetHumanState();
                resetHandReveal();
                suitUsageRef.current = new Map();
                if (nextDeckAudit) {
                  nextDeckAudit = null;
                  deckAuditChanged = true;
                }
                continue;
              }
              if (m.type === 'event' && m.kind === 'round-end') {
                nextLog = [...nextLog, `【边界】round-end #${m.round}`];
                const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                resetHumanState();
                continue;
              }

              // -------- 初始发牌（仅限 init 帧） --------
              const isInitState = m.type === 'init' || (m.type === 'state' && m.kind === 'init');
              if (isInitState) {
                const rh = Array.isArray(m.hands)
                  ? m.hands
                  : Array.isArray(m.payload?.hands)
                    ? m.payload.hands
                    : [];
                if (Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0])) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1; // 仅开局重置；后续“抢”只做×2
                  const freshUsage: RankSuitUsage = new Map();
                  const seatPrefs = extractAllSeatSuitPrefs(rh as string[][]);
                  nextHands = (rh as string[][]).map((hand, seatIdx) => {
                    const reservedBase = snapshotSuitUsage(freshUsage);
                    const reserved = mergeReservedWithForeign(reservedBase, seatIdx, seatPrefs);
                    const preferred = seatPrefs?.[seatIdx];
                    const decorated = reconcileHandFromRaw(hand, [], reserved, preferred);
                    registerSuitUsage(freshUsage, ownerKeyForSeat(seatIdx), decorated);
                    return decorated;
                  });
                  suitUsageRef.current = freshUsage;

                  const rawLord = m.landlordIdx ?? m.landlord ?? m.payload?.landlord ?? null;
                  const lord = (typeof rawLord === 'number' && rawLord >= 0 && rawLord < 3)
                    ? rawLord
                    : null;
                  nextLandlord = lord;
                  const bottomRaw = Array.isArray(m.bottom)
                    ? (m.bottom as string[])
                    : Array.isArray(m.payload?.bottom)
                      ? (m.payload.bottom as string[])
                      : [];
                  const bottomReserved = snapshotSuitUsage(freshUsage);
                  const decoratedBottom = bottomRaw.length
                    ? resolveBottomDecorations(bottomRaw, lord, nextHands as string[][], bottomReserved)
                    : [];
                  nextBottom = {
                    landlord: lord ?? null,
                    cards: decoratedBottom.map(label => ({ label, used: false })),
                    revealed: false,
                  };
                  updateDeckAuditSnapshot(nextHands as string[][], nextBottom);
                  {
                    const n0 = Math.max(nextScores[0]?.length||0, nextScores[1]?.length||0, nextScores[2]?.length||0);
                    const lordVal = (lord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) { nextCuts = [...nextCuts, n0]; nextLords = [...nextLords, lordVal]; }
                  }
                  // 若本局地主刚刚确认，回填到最近一段的 roundLords，避免底色为白
                  if (nextCuts.length > 0) {
                    const idxBand = Math.max(0, nextCuts.length - 1);
                    const lordVal2 = (nextLandlord ?? -1) as number | -1;
                    if (nextLords[idxBand] !== lordVal2) {
                      nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                    }
                  }

                  const initLabel = m.type === 'state' ? '（state）' : '';
                  nextLog = [...nextLog, `发牌完成${initLabel}，${lord != null ? seatName(lord) : '?' }为地主`];

                  try { applyTsFromStoreByRole(lord, '发牌后'); } catch {}
                  lastReasonRef.current = [null, null, null];
                }
                continue;
              }

              
              // -------- 首次手牌兜底注入（若没有 init 帧但消息里带了 hands） --------
              {
                const rh0 = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                if ((!nextHands || !(nextHands[0]?.length)) && Array.isArray(rh0) && rh0.length === 3 && Array.isArray(rh0[0])) {
                  const freshUsage: RankSuitUsage = new Map();
                  const seatPrefs = extractAllSeatSuitPrefs(rh0 as string[][]);
                  nextHands = (rh0 as string[][]).map((hand, seatIdx) => {
                    const reservedBase = snapshotSuitUsage(freshUsage);
                    const reserved = mergeReservedWithForeign(reservedBase, seatIdx, seatPrefs);
                    const preferred = seatPrefs?.[seatIdx];
                    const decorated = reconcileHandFromRaw(hand, [], reserved, preferred);
                    registerSuitUsage(freshUsage, ownerKeyForSeat(seatIdx), decorated);
                    return decorated;
                  });
                  suitUsageRef.current = freshUsage;
                  const rawLord2 = m.landlordIdx ?? m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                  const lord2 = (typeof rawLord2 === 'number' && rawLord2 >= 0 && rawLord2 < 3)
                    ? rawLord2
                    : null;
                  if (lord2 != null) {
                    nextLandlord = lord2;
                    if (nextBottom.landlord !== lord2) {
                      const keep = Array.isArray(nextBottom.cards)
                        ? nextBottom.cards.map(c => ({ ...c }))
                        : [];
                      nextBottom = { landlord: lord2, cards: keep, revealed: !!nextBottom.revealed };
                    }
                  }
                  const bottom0 = m.bottom ?? m.payload?.bottom ?? m.state?.bottom ?? m.init?.bottom;
                  if (Array.isArray(bottom0)) {
                    const bottomReserved0 = snapshotSuitUsage(freshUsage);
                    const decoratedBottom0 = resolveBottomDecorations(
                      bottom0 as string[],
                      nextLandlord ?? nextBottom.landlord ?? null,
                      nextHands as string[][],
                      bottomReserved0,
                    );
                    nextBottom = {
                      landlord: nextLandlord ?? nextBottom.landlord ?? null,
                      cards: decoratedBottom0.map(label => ({ label, used: false })),
                      revealed: false,
                    };
                    updateDeckAuditSnapshot(nextHands as string[][], nextBottom);
                  }
                  // 不重置倍数/不清空已产生的出牌，避免覆盖后续事件
                  nextLog = [...nextLog, `发牌完成（推断），${lord2 != null ? seatName(lord2) : '?' }为地主`];
                  {
                    // —— 兜底：没有 init 帧也要推进 roundCuts / roundLords ——
                    const n0 = Math.max(
                      nextScores[0]?.length||0,
                      nextScores[1]?.length||0,
                      nextScores[2]?.length||0
                    );
                    const lordVal = (nextLandlord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) {
                      nextCuts = [...nextCuts, n0];
                      nextLords = [...nextLords, lordVal];
                    }
                    // 若本局地主刚刚确认，回填最近一段的 roundLords，避免底色为白
                    if (nextCuts.length > 0) {
                      const idxBand = Math.max(0, nextCuts.length - 1);
                      const lordVal2 = (nextLandlord ?? -1) as number | -1;
                      if (nextLords[idxBand] !== lordVal2) {
                        nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                      }
                    }
                  }

                }
              }

              if (m.type === 'human-request') {
                const seat = typeof m.seat === 'number' ? m.seat : -1;
                if (seat >= 0 && seat < 3) {
                  const requestId = typeof m.requestId === 'string' ? m.requestId : `${Date.now()}-${Math.random()}`;
                  const rawHint = (m as any).hint ?? (m as any).suggestion;
                  let hint: HumanHint | undefined;
                  if (rawHint && typeof rawHint === 'object') {
                    const move = rawHint.move === 'play' ? 'play' : 'pass';
                    const cards = Array.isArray(rawHint.cards) ? rawHint.cards.map((c: any) => String(c)) : undefined;
                    const scoreVal = Number((rawHint as any).score);
                    const score = Number.isFinite(scoreVal) ? scoreVal : undefined;
                    const reason = typeof rawHint.reason === 'string' ? rawHint.reason : undefined;
                    const label = typeof rawHint.label === 'string' ? rawHint.label : undefined;
                    const byHint = typeof rawHint.by === 'string' ? rawHint.by : undefined;
                    hint = { move, cards, score, reason, label, by: byHint };
                  }
                  const ctxHandsRaw = Array.isArray((m as any)?.ctx?.hands)
                    ? ((m as any).ctx.hands as any[]).map(card => String(card))
                    : null;
                  if (ctxHandsRaw && ctxHandsRaw.length > 0) {
                    const prevHand = Array.isArray(nextHands?.[seat]) ? (nextHands[seat] as string[]) : [];
                    const usage = suitUsageRef.current;
                    const ownerKey = ownerKeyForSeat(seat);
                    unregisterSuitUsage(usage, ownerKey, prevHand);
                    const reservedBase = snapshotSuitUsage(usage, ownerKey);
                    const seatPrefsSingle: SeatSuitPrefs = [];
                    const preferred = extractSeatSuitPrefs(ctxHandsRaw);
                    seatPrefsSingle[seat] = preferred;
                    const reserved = mergeReservedWithForeign(reservedBase, seat, seatPrefsSingle);
                    const decorated = reconcileHandFromRaw(ctxHandsRaw, prevHand, reserved, preferred);
                    nextHands = Object.assign([], nextHands, { [seat]: decorated });
                    registerSuitUsage(usage, ownerKey, decorated);
                    suitUsageRef.current = usage;
                  }
                  if (hint && hint.move === 'play' && Array.isArray(hint.cards)) {
                    const seatHandSnapshot = Array.isArray(nextHands?.[seat]) ? (nextHands[seat] as string[]) : [];
                    if (seatHandSnapshot.length > 0) {
                      const usedLocal = new Set<number>();
                      const missingRaw: string[] = [];
                      for (const cardLabel of hint.cards) {
                        const options = candDecorations(String(cardLabel));
                        const matchIdx = seatHandSnapshot.findIndex((card, idx) => !usedLocal.has(idx) && options.includes(card));
                        if (matchIdx >= 0) {
                          usedLocal.add(matchIdx);
                        } else {
                          missingRaw.push(String(cardLabel));
                        }
                      }
                      if (missingRaw.length) {
                        const missingDisplay = missingRaw.map(label => displayLabelFromRaw(String(label)));
                        hint = { ...hint, valid: false, missing: missingDisplay };
                        nextLog = [...nextLog, `【Human】${seatName(seat)} 提示包含无效牌：${missingDisplay.join('、')}`];
                      } else {
                        hint = { ...hint, valid: true, missing: [] };
                      }
                    }
                  }
                  const timeoutRaw = typeof m.timeoutMs === 'number' ? m.timeoutMs : Number((m as any).timeout_ms);
                  const timeoutParsed = Number.isFinite(timeoutRaw) ? Math.max(0, Math.floor(timeoutRaw)) : undefined;
                  const rawPhase = typeof m.phase === 'string' ? m.phase : 'play';
                  const normalizedPhase = rawPhase === 'bid'
                    ? 'bid'
                    : rawPhase === 'double'
                      ? 'double'
                      : rawPhase;
                  const issuedAtRaw = (m as any).issuedAt ?? (m as any).issued_at;
                  const expiresAtRaw = (m as any).expiresAt ?? (m as any).expires_at;
                  const issuedAtParsed = typeof issuedAtRaw === 'number' ? issuedAtRaw : Number(issuedAtRaw);
                  const expiresAtParsed = typeof expiresAtRaw === 'number' ? expiresAtRaw : Number(expiresAtRaw);
                  const serverIssuedAt = Number.isFinite(issuedAtParsed) ? issuedAtParsed : undefined;
                  const serverExpiresAt = Number.isFinite(expiresAtParsed) ? expiresAtParsed : undefined;
                  const serverWindowMs = (typeof serverExpiresAt === 'number' && typeof serverIssuedAt === 'number')
                    ? Math.max(0, Math.floor(serverExpiresAt - serverIssuedAt))
                    : undefined;
                  const fallbackTimeoutMs = (typeof timeoutParsed === 'number' && timeoutParsed > 0)
                    ? timeoutParsed
                    : 30_000;
                  const clientIssuedAt = Date.now();
                  const upstreamLagMs = Number.isFinite(issuedAtParsed)
                    ? Math.max(0, clientIssuedAt - issuedAtParsed)
                    : 0;
                  let totalWindowMs = Math.max(0, fallbackTimeoutMs);
                  if (typeof serverWindowMs === 'number' && serverWindowMs > 0) {
                    totalWindowMs = serverWindowMs;
                  }
                  if (normalizedPhase === 'bid' || normalizedPhase === 'double') {
                    totalWindowMs = 30_000;
                  }
                  let elapsedSinceIssued = typeof serverIssuedAt === 'number'
                    ? Math.max(0, clientIssuedAt - serverIssuedAt)
                    : upstreamLagMs;
                  if (typeof serverIssuedAt === 'number' && elapsedSinceIssued > totalWindowMs * 2) {
                    elapsedSinceIssued = upstreamLagMs;
                  }
                  let resolvedWindowMs = Math.max(0, totalWindowMs - elapsedSinceIssued);
                  if (typeof serverExpiresAt === 'number') {
                    const serverRemaining = Math.max(0, Math.floor(serverExpiresAt - clientIssuedAt));
                    if (serverRemaining > 0 || resolvedWindowMs === 0) {
                      resolvedWindowMs = Math.min(resolvedWindowMs, serverRemaining);
                    }
                  }
                  const clientExpiresAt = clientIssuedAt + resolvedWindowMs;
                  humanCallIssuedAtRef.current[seat] = clientIssuedAt;
                  humanActiveRequestRef.current[seat] = requestId;
                  setHumanRequest({
                    seat,
                    requestId,
                    phase: normalizedPhase,
                    ctx: m.ctx ?? {},
                    timeoutMs: resolvedWindowMs,
                    totalTimeoutMs: totalWindowMs,
                    latencyMs: upstreamLagMs,
                    remainingMs: resolvedWindowMs,
                    delayMs: typeof m.delayMs === 'number' ? m.delayMs : undefined,
                    by: typeof m.by === 'string' ? m.by : undefined,
                    hint,
                    issuedAt: clientIssuedAt,
                    expiresAt: clientExpiresAt,
                    serverIssuedAt: Number.isFinite(issuedAtParsed) ? issuedAtParsed : undefined,
                    serverExpiresAt: Number.isFinite(expiresAtParsed) ? expiresAtParsed : undefined,
                    stale: resolvedWindowMs <= 0,
                  });
                  setHumanClockTs(clientIssuedAt);
                  setHumanSelectedIdx([]);
                  setHumanSubmitting(false);
                  setHumanError(null);
                  const label = seatName(seat);
                  const phaseLabel = normalizedPhase;
                  nextLog = [...nextLog, `【Human】${label} 等待操作｜phase=${phaseLabel}`];
                }
                continue;
              }

              // -------- AI 过程日志 --------
              if (m.type === 'event' && m.kind === 'bot-call') {
                const prefix = isHumanSeat(m.seat) ? 'Human' : 'AI';
                const seatIdx = typeof m.seat === 'number' ? m.seat : -1;
                if (seatIdx >= 0 && seatIdx < 3 && !isHumanSeat(seatIdx)) {
                  const timeoutRaw = typeof m.timeoutMs === 'number' ? m.timeoutMs : Number((m as any).timeout_ms);
                  const rawPhase = typeof m.phase === 'string' ? m.phase : 'play';
                  const normalizedPhase = rawPhase === 'bid'
                    ? 'bid'
                    : rawPhase === 'double'
                      ? 'double'
                      : rawPhase;
                  const resolvedTimeout = (normalizedPhase === 'bid' || normalizedPhase === 'double')
                    ? 30_000
                    : (Number.isFinite(timeoutRaw)
                      ? Math.max(1_000, Math.min(30_000, Math.floor(timeoutRaw)))
                      : 30_000);
                  const clientIssuedAt = Date.now();
                  const phaseLabel = normalizedPhase;
                  const providerLabel = typeof m.by === 'string' ? m.by : undefined;
                  setBotTimers(prev => {
                    const next = [...prev];
                    next[seatIdx] = {
                      seat: seatIdx,
                      phase: phaseLabel,
                      timeoutMs: resolvedTimeout,
                      issuedAt: clientIssuedAt,
                      expiresAt: clientIssuedAt + resolvedTimeout,
                      provider: providerLabel,
                    };
                    return next;
                  });
                  botCallIssuedAtRef.current[seatIdx] = clientIssuedAt;
                  setBotClockTs(clientIssuedAt);
                }
                nextLog = [...nextLog, `${prefix}调用｜${seatName(m.seat)}｜${m.by ?? agentIdForIndex(m.seat)}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'unknown'}${m.need ? `｜需求=${m.need}` : ''}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'bot-done') {
                const isHuman = isHumanSeat(m.seat);
                const prefix = isHuman ? 'Human' : 'AI';
                const seatIdx = typeof m.seat === 'number' ? m.seat : -1;
                if (seatIdx >= 0 && seatIdx < 3) {
                  setBotTimers(prev => {
                    if (!prev[seatIdx]) return prev;
                    const next = [...prev];
                    next[seatIdx] = null;
                    return next;
                  });
                }
                const rawReason = typeof m.reason === 'string' ? m.reason : undefined;
                const showReason = rawReason && canDisplaySeatReason(m.seat);
                nextLog = [
                  ...nextLog,
                  `${prefix}完成｜${seatName(m.seat)}｜${m.by ?? agentIdForIndex(m.seat)}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                  ...(showReason ? [`${prefix}理由｜${seatName(m.seat)}：${rawReason}`] : []),
                ];
                if (seatIdx >= 0 && seatIdx < 3) {
                  const tookMsRaw = Number((m as any).tookMs ?? (m as any).latencyMs ?? (m as any).delayMs ?? NaN);
                  const startAt = isHuman
                    ? humanCallIssuedAtRef.current[seatIdx]
                    : botCallIssuedAtRef.current[seatIdx];
                  let measured: number | null = null;
                  if (Number.isFinite(tookMsRaw) && tookMsRaw >= 0) {
                    measured = tookMsRaw;
                  } else if (typeof startAt === 'number') {
                    measured = Math.max(0, Date.now() - startAt);
                  }
                  if (typeof measured === 'number') {
                    recordThought(seatIdx, measured, line => { nextLog = [...nextLog, line]; });
                  }
                  if (isHuman) {
                    delete humanCallIssuedAtRef.current[seatIdx];
                    delete humanActiveRequestRef.current[seatIdx];
                  } else {
                    const usageRaw = (m as any)?.usage;
                    const totalTokens = Number((usageRaw?.totalTokens ?? usageRaw?.total_tokens ?? NaN));
                    if (
                      typeof measured === 'number' && measured > 0 &&
                      typeof m.by === 'string' && m.by === 'ai:kimi' &&
                      Number.isFinite(totalTokens) && totalTokens > 0
                    ) {
                      const promptTokens = Number((usageRaw?.promptTokens ?? usageRaw?.prompt_tokens ?? NaN));
                      const completionTokens = Number((usageRaw?.completionTokens ?? usageRaw?.completion_tokens ?? NaN));
                      const perCallTpm = (totalTokens * 60_000) / measured;
                      const prev = kimiTpmRef.current || { count: 0, avg: 0, totalTokens: 0, last: undefined };
                      const prevCount = Number.isFinite(prev.count) && prev.count > 0 ? prev.count : 0;
                      const nextCount = prevCount + 1;
                      const nextAvg = (prev.avg * prevCount + perCallTpm) / nextCount;
                      const nextTotal = (prev.totalTokens || 0) + totalTokens;
                      kimiTpmRef.current = { count: nextCount, avg: nextAvg, totalTokens: nextTotal, last: perCallTpm };
                      const fmtRate = (value: number) => (value >= 1000 ? value.toFixed(0) : value.toFixed(1));
                      const promptLabel = Number.isFinite(promptTokens) && promptTokens >= 0 ? `｜prompt=${promptTokens.toFixed(0)}` : '';
                      const completionLabel = Number.isFinite(completionTokens) && completionTokens >= 0 ? `｜completion=${completionTokens.toFixed(0)}` : '';
                      nextLog = [
                        ...nextLog,
                        `【Kimi】tokens=${totalTokens.toFixed(0)}${promptLabel}${completionLabel}｜TPM≈${fmtRate(perCallTpm)}｜avg≈${fmtRate(nextAvg)}｜calls=${nextCount}`,
                      ];
                    }
                    delete botCallIssuedAtRef.current[seatIdx];
                  }
                }
                if (isHuman) {
                  setHumanSubmitting(false);
                  setHumanRequest(prev => (prev && prev.seat === m.seat ? null : prev));
                  setHumanSelectedIdx([]);
                }
                lastReasonRef.current[m.seat] = rawReason || null;
                continue;
              }

              // -------- 抢/不抢 --------
              if (m.type === 'event' && m.kind === 'bid') {
  const mm = Number((m as any).mult || 0);
  const bb = Number((m as any).bidMult || 0);
  if (Number.isFinite(bb) && bb > 0) nextBidMultiplier = Math.max(nextBidMultiplier || 1, bb);
  else if (m.bid) nextBidMultiplier = Math.min(64, Math.max(1, (nextBidMultiplier || 1) * 2));
  if (Number.isFinite(mm) && mm > 0) nextMultiplier = Math.max(nextMultiplier || 1, mm);
  else if (m.bid) nextMultiplier = Math.min(64, Math.max(1, (nextMultiplier || 1) * 2));
  const sc = (typeof (m as any).score === 'number' ? (m as any).score : Number((m as any).score || NaN));
  const scTxt = Number.isFinite(sc) ? sc.toFixed(2) : '-';
  nextLog = [...nextLog, `${seatName(m.seat)} ${m.bid ? '抢地主' : '不抢'}｜score=${scTxt}｜叫抢x${nextBidMultiplier}｜对局x${nextMultiplier}`];
  const seatIdx = (typeof m.seat === 'number') ? m.seat as number : -1;
  const explicitLordRaw = (m as any).landlordIdx ?? (m as any).landlord;
  const explicitLord = (typeof explicitLordRaw === 'number') ? explicitLordRaw : null;
  if (explicitLord != null && explicitLord >= 0 && explicitLord < 3) {
    nextLandlord = explicitLord;
  } else if (seatIdx >= 0 && seatIdx < 3 && m.bid) {
    nextLandlord = seatIdx;
  }
  if (typeof nextLandlord === 'number' && nextLandlord >= 0 && nextLandlord < 3) {
    if (nextBottom.landlord !== nextLandlord) {
      const keep = Array.isArray(nextBottom.cards)
        ? nextBottom.cards.map(c => ({ ...c }))
        : [];
      nextBottom = { landlord: nextLandlord, cards: keep, revealed: !!nextBottom.revealed };
    }
  }
  continue;
              }
else if (m.type === 'event' && m.kind === 'bid-eval') {
  const who = (typeof seatName==='function') ? seatName(m.seat) : `seat${m.seat}`;
  const sc  = (typeof m.score==='number' && isFinite(m.score)) ? m.score.toFixed(2) : String(m.score);
  const thr = (typeof m.threshold==='number' && isFinite(m.threshold)) ? m.threshold.toFixed(2) : String(m.threshold ?? '');
  const dec = m.decision || 'pass';
  const line = `${who} 评估｜score=${sc}｜阈值=${thr}｜决策=${dec}`;
  nextLog.push(line);
}


              // -------- 明牌后额外加倍 --------
// -------- 倍数校准（兜底） --------

// ------ 明牌（显示底牌） ------
if (m.type === 'event' && m.kind === 'reveal') {
  const btm = Array.isArray((m as any).bottom) ? (m as any).bottom : [];
  const seatIdxRaw = (typeof (m.landlordIdx ?? m.landlord) === 'number')
    ? (m.landlordIdx ?? m.landlord) as number
    : nextLandlord;
  const landlordSeat = (typeof seatIdxRaw === 'number') ? seatIdxRaw : (nextLandlord ?? nextBottom.landlord ?? null);
  const reservedForBottom = snapshotSuitUsage(suitUsageRef.current);
  const mapped = resolveBottomDecorations(btm, landlordSeat, nextHands as string[][], reservedForBottom);

  if (typeof landlordSeat === 'number' && landlordSeat >= 0 && landlordSeat < 3) {
    let seatHand = Array.isArray(nextHands[landlordSeat]) ? [...nextHands[landlordSeat]] : [];
    const usage = suitUsageRef.current;
    const ownerKey = ownerKeyForSeat(landlordSeat);
    unregisterSuitUsage(usage, ownerKey, Array.isArray(nextHands[landlordSeat]) ? nextHands[landlordSeat] : []);
    const prevBottom = bottomRef.current;
    if (prevBottom && prevBottom.landlord === landlordSeat && Array.isArray(prevBottom.cards)) {
      for (const prevCard of prevBottom.cards) {
        const idxPrev = seatHand.indexOf(prevCard.label);
        if (idxPrev >= 0) seatHand.splice(idxPrev, 1);
      }
    }
    seatHand = sortDisplayHand([...seatHand, ...mapped]);
    nextHands = Object.assign([], nextHands, { [landlordSeat]: seatHand });
    registerSuitUsage(usage, ownerKey, seatHand);
    suitUsageRef.current = usage;
  }

  nextBottom = {
    landlord: landlordSeat ?? nextBottom.landlord ?? null,
    cards: mapped.map(label => ({ label, used: false })),
    revealed: true,
  };
  const pretty = mapped.length ? mapped : (decorateHandCycle ? decorateHandCycle(btm) : btm);
  nextLog = [...nextLog, `明牌｜底牌：${pretty.join(' ')}`];
  // 不改变 nextMultiplier，仅展示
  continue;
}
if (m.type === 'event' && m.kind === 'multiplier-sync') {
  const cur = Math.max(1, (nextMultiplier || 1));
  const mlt = Math.max(1, Number((m as any).multiplier || 1));
  nextMultiplier = Math.max(cur, mlt);
  const bcur = Math.max(1, (nextBidMultiplier || 1));
  const bmlt = Math.max(1, Number((m as any).bidMult || 1));
  nextBidMultiplier = Math.max(bcur, bmlt);
  nextLog = [...nextLog, `倍数校准为 叫抢x${nextBidMultiplier}｜对局x${nextMultiplier}`];
  continue;
}


// ------ 明牌后独立加倍：逐家决策 ------
if (m.type === 'event' && m.kind === 'double-decision') {
  const who = seatName(m.seat);
  const decided = m.double ? '加倍' : '不加倍';
  const parts: string[] = [ `[加倍阶段] ${who}${m.role==='landlord'?'(地主)':''} ${decided}` ];
  if (typeof m.delta === 'number' && isFinite(m.delta)) parts.push(`Δ=${m.delta.toFixed(2)}`);
  if (typeof m.dLhat === 'number' && isFinite(m.dLhat)) parts.push(`Δ̂=${m.dLhat.toFixed(2)}`);
  if (typeof m.counter === 'number' && isFinite(m.counter)) parts.push(`counter=${m.counter.toFixed(2)}`);
  if (typeof m.reason === 'string' && canDisplaySeatReason(m.seat)) parts.push(`理由=${m.reason}`);
  if (m.bayes && (typeof m.bayes.landlord!=='undefined' || typeof m.bayes.farmerY!=='undefined')) {
    const l = Number(m.bayes.landlord||0), y = Number(m.bayes.farmerY||0);
    parts.push(`bayes:{L=${l},Y=${y}}`);
  }
  nextLog = [...nextLog, parts.join('｜')];
  continue;
}

// ------ 明牌后独立加倍：汇总 ------
if (m.type === 'event' && m.kind === 'double-summary') {
  const base = Math.max(1, Number((m as any).base || 1));
  const yi   = Math.max(1, Number((m as any).mulY || (m as any).multiplierYi || 1));
  const bing = Math.max(1, Number((m as any).mulB || (m as any).multiplierBing || 1));
  nextLog = [...nextLog,
    `明牌加倍汇总｜基础x${base}`,
    `对乙x${yi}｜对丙x${bing}`
  ];
  // 不直接改 nextMultiplier，保持旧逻辑一致性
  continue;
}
if (m.type === 'event' && m.kind === 'hand-snapshot') {
  const stageRaw = typeof (m as any).stage === 'string'
    ? String((m as any).stage)
    : (typeof (m as any).phase === 'string' ? String((m as any).phase) : 'snapshot');
  const stageLabel = stageRaw === 'pre-play'
    ? '开局手牌'
    : stageRaw === 'post-game'
      ? '结算余牌'
      : `手牌快照(${stageRaw})`;
  const rawHands = Array.isArray(m.hands) ? (m.hands as any[][]) : null;
  const hasRawHands = !!(rawHands && rawHands.length === 3 && rawHands.every(h => Array.isArray(h)));
  const seatParts = [0, 1, 2].map(seat => {
    const snapshotHand = rawHands && Array.isArray(rawHands[seat])
      ? (rawHands[seat] as any[]).map(card => String(card))
      : [];
    const currentHand = Array.isArray(nextHands?.[seat]) ? (nextHands[seat] as string[]) : null;
    const cards = snapshotHand.length ? snapshotHand : (currentHand || []);
    const pretty = cards && cards.length ? cards.join(' ') : '（无）';
    return `${seatName(seat)}：${pretty}`;
  });
  let header = stageLabel;
  const revealSeatsRaw = Array.isArray((m as any).revealSeats) ? (m as any).revealSeats as any[] : [];
  const revealSeats = revealSeatsRaw
    .map(v => Number(v))
    .filter(seat => Number.isInteger(seat) && seat >= 0 && seat < 3);
  const durationRaw = Number((m as any).revealDurationMs ?? (m as any).durationMs ?? 0);
  const duration = Number.isFinite(durationRaw) ? Math.max(0, Math.floor(durationRaw)) : 0;
  const revealDuration = revealSeats.length ? (duration > 0 ? duration : 5000) : 0;
  if (revealSeats.length) {
    const revealLabel = revealSeats.map(seatName).join('、');
    const showDuration = revealDuration;
    if (showDuration > 0) {
      const seconds = showDuration >= 1000
        ? (showDuration % 1000 === 0 ? (showDuration / 1000).toFixed(0) : (showDuration / 1000).toFixed(1))
        : showDuration.toString();
      header += `｜明牌：${revealLabel}（${showDuration >= 1000 ? `${seconds}s` : `${seconds}ms`}）`;
    } else {
      header += `｜明牌：${revealLabel}`;
    }
    queueHandReveal(revealSeats, revealDuration);
  }
  if (hasRawHands) {
    const resetForStage = stageRaw === 'pre-play';
    const freshUsage = new Map<string, Map<string, SuitUsageOwner>>() as RankSuitUsage;
    const seatPrefs = extractAllSeatSuitPrefs(rawHands as string[][]);
    const baseline = resetForStage
      ? [[], [], []]
      : (Array.isArray(nextHands) ? nextHands : [[], [], []]);
    const decoratedHands = (rawHands as string[][]).map((hand, seatIdx) => {
      const prev = Array.isArray(baseline?.[seatIdx]) ? baseline[seatIdx] as string[] : [];
      const reservedBase = snapshotSuitUsage(freshUsage);
      const reserved = mergeReservedWithForeign(reservedBase, seatIdx, seatPrefs);
      const preferred = seatPrefs?.[seatIdx];
      const decorated = reconcileHandFromRaw(hand, prev, reserved, preferred);
      registerSuitUsage(freshUsage, ownerKeyForSeat(seatIdx), decorated);
      return decorated;
    }) as string[][];
    suitUsageRef.current = freshUsage;
    nextHands = decoratedHands;
    if (resetForStage) {
      updateDeckAuditSnapshot(decoratedHands, nextBottom);
    }
  }
  const seatLines = seatParts.map(part => `  ${part}`);
  nextLog = [...nextLog, header, ...seatLines];
  continue;
}
if (m.type === 'event' && (m.kind === 'extra-double' || m.kind === 'post-double')) {
  if (m.do) nextMultiplier = Math.max(1, (nextMultiplier || 1) * 2);
  nextLog = [...nextLog, `${seatName(m.seat)} ${m.do ? '加倍' : '不加倍'}（明牌后）`];
  continue;
}
// -------- 起新墩 --------
              if (m.type === 'event' && m.kind === 'trick-reset') {
                nextLog = [...nextLog, '一轮结束，重新起牌'];
                nextPlays = [];
                const idxBreak = Math.max(
                  nextScores[0]?.length||0,
                  nextScores[1]?.length||0,
                  nextScores[2]?.length||0,
                );
                if (idxBreak > 0 && nextBreaks[nextBreaks.length-1] !== idxBreak) {
                  nextBreaks = [...nextBreaks, idxBreak];
                }
                continue;
              }

              // -------- 出/过 --------
              
                // （fallback）若本批次没有收到 'turn' 行，则从 event:play 中恢复 score
                if (!sawAnyTurn) {
                  const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                  if (s>=0 && s<3) {
                    let val: number|null = (typeof (m as any).score === 'number') ? (m as any).score as number : null;
                    if (typeof val !== 'number') {
                      const rr = (m.reason ?? lastReasonRef.current?.[s] ?? '') as string;
                      const mm = /score=([+-]?\d+(?:\.\d+)?)/.exec(rr || '');
                      if (mm) { val = parseFloat(mm[1]); }
                    }
                    for (let i=0;i<3;i++){
                      if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                      nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                    }
                  }
                }

              // -------- 记录 turn（含 score） --------
              if (m.type === 'turn') {
                const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                if (s>=0 && s<3) {
                  sawAnyTurn = true;
                  const val = (typeof m.score === 'number') ? (m.score as number) : null;
                  for (let i=0;i<3;i++){
                    if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                    nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                  }
                  if (Array.isArray(m.hand)) {
                    const prevHand = Array.isArray(nextHands?.[s]) ? nextHands[s] : [];
                    const usage = suitUsageRef.current;
                    const ownerKey = ownerKeyForSeat(s);
                    unregisterSuitUsage(usage, ownerKey, prevHand);
                    const reservedBase = snapshotSuitUsage(usage);
                    const preferred = extractSeatSuitPrefs(m.hand as string[]);
                    const updatedHand = reconcileHandFromRaw(m.hand as string[], prevHand, reservedBase, preferred);
                    registerSuitUsage(usage, ownerKey, updatedHand);
                    suitUsageRef.current = usage;
                    nextHands = Object.assign([], nextHands, { [s]: updatedHand });
                    if (s === (nextBottom.landlord ?? -1) && nextBottom.cards.length) {
                      const bottomCards = nextBottom.cards.map(card => ({
                        ...card,
                        used: !updatedHand.includes(card.label),
                      }));
                      nextBottom = { ...nextBottom, cards: bottomCards };
                    }
                  }
                  if (Array.isArray(m.totals) && m.totals.length === 3) {
                    const totalsArr = (m.totals as any[]).map(v => Number(v));
                    nextTotals = [0,1,2].map((idx) => (
                      Number.isFinite(totalsArr[idx]) ? totalsArr[idx] : nextTotals[idx]
                    )) as [number, number, number];
                  }
                }
                continue;
              }
if (m.type === 'event' && m.kind === 'play') {
                if (m.move === 'pass') {
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  const reasonForLog = reason && canDisplaySeatReason(m.seat) ? reason : undefined;
                  lastReasonRef.current[m.seat] = null;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'pass', reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 过${reasonForLog ? `（${reasonForLog}）` : ''}`];
                } else {
                  const pretty: string[] = [];
                  const seat = m.seat as number;
                  const cards: string[] = m.cards || [];
                  const nh = (nextHands && (nextHands as any[]).length === 3 ? nextHands : [[], [], []]).map((x: any) => [...x]);
                  const usage = suitUsageRef.current;
                  const ownerKey = ownerKeyForSeat(seat);
                  const prevSeatHand = Array.isArray(nextHands?.[seat]) ? nextHands[seat] : [];
                  unregisterSuitUsage(usage, ownerKey, prevSeatHand);
                  for (const rawCard of cards) {
                    const options = candDecorations(rawCard);
                    const chosen = options.find((d: string) => nh[seat].includes(d)) || options[0];
                    const k = nh[seat].indexOf(chosen);
                    if (k >= 0) nh[seat].splice(k, 1);
                    pretty.push(chosen);
                  }
                  if (seat === (nextBottom.landlord ?? -1) && pretty.length && nextBottom.cards.length) {
                    const updated = nextBottom.cards.map(c => ({ ...c }));
                    for (const label of pretty) {
                      const idxCard = updated.findIndex(c => !c.used && c.label === label);
                      if (idxCard >= 0) {
                        updated[idxCard] = { ...updated[idxCard], used: true };
                      }
                    }
                    nextBottom = { ...nextBottom, cards: updated };
                  }
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;

                  nextHands = nh;
                  registerSuitUsage(usage, ownerKey, nh[seat]);
                  suitUsageRef.current = usage;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                  const reasonForLog = reason && canDisplaySeatReason(m.seat) ? reason : undefined;
                  nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reasonForLog ? `（理由：${reasonForLog}）` : ''}`];
                }
                continue;
              }

              // -------- 结算（多种别名兼容） --------
              const isWinLike =
                (m.type === 'event' && (m.kind === 'win' || m.kind === 'result' || m.kind === 'game-over' || m.kind === 'game_end')) ||
                (m.type === 'result') || (m.type === 'game-over') || (m.type === 'game_end');
              if (isWinLike) {
                const L = (nextLandlord ?? 0) as number;
                const prevTotals = (() => {
                  const stored = roundBaseTotalsRef.current;
                  if (stored && stored.length === 3) {
                    return [stored[0], stored[1], stored[2]] as [number, number, number];
                  }
                  return [nextTotals[0], nextTotals[1], nextTotals[2]] as [number, number, number];
                })();

                const totalsMsgRaw = Array.isArray(m.totals)
                  ? (m.totals as any[])
                  : Array.isArray((m as any)?.payload?.totals)
                    ? ((m as any).payload.totals as any[])
                    : null;
                const totalsFromMsg = (() => {
                  if (!totalsMsgRaw || totalsMsgRaw.length !== 3) return null;
                  return totalsMsgRaw.map((value, idx) => {
                    const num = Number(value);
                    if (Number.isFinite(num)) return num;
                    const fallback = prevTotals[idx];
                    return Number.isFinite(fallback) ? fallback : 0;
                  }) as [number, number, number];
                })();

                const rawDelta = (Array.isArray(m.deltaScores) ? m.deltaScores
                  : Array.isArray(m.delta) ? m.delta
                  : null) as [number, number, number] | null;
                let ds = rawDelta ? rawDelta.map(v => Number(v) || 0) as [number, number, number] : null;

                if ((!ds || !Number.isFinite(ds[0])) && totalsFromMsg && L >= 0 && L < 3) {
                  const seatDiff = totalsFromMsg.map((val, idx) => val - prevTotals[idx]) as [number, number, number];
                  ds = [
                    seatDiff[L] ?? 0,
                    seatDiff[(L + 1) % 3] ?? 0,
                    seatDiff[(L + 2) % 3] ?? 0,
                  ];
                }

                if (!ds) {
                  ds = [0,0,0];
                }

                // 将“以地主为基准”的增减分旋转成“按座位顺序”的展示
                const rot: [number,number,number] = [
                  ds[(0 - L + 3) % 3],
                  ds[(1 - L + 3) % 3],
                  ds[(2 - L + 3) % 3],
                ];
                let nextWinnerLocal     = m.winner ?? nextWinner ?? null;
                const effMult = (m.multiplier ?? (nextMultiplier ?? 1));
                const sumAbs = Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]);
                const needScale = effMult > 1 && (sumAbs === 4 || (sumAbs % effMult !== 0));
                const rot2 = needScale
                  ? (rot.map(v => (typeof v === 'number' ? v * effMult : v)) as [number, number, number])
                  : rot;
                nextMultiplier = effMult;
                nextDelta      = rot2;

                if (Array.isArray(totalsFromMsg)) {
                  nextTotals = totalsFromMsg as [number, number, number];
                } else {
                  nextTotals = [
                    nextTotals[0] + rot2[0],
                    nextTotals[1] + rot2[1],
                    nextTotals[2] + rot2[2]
                  ] as any;
                }

                roundBaseTotalsRef.current = [nextTotals[0], nextTotals[1], nextTotals[2]] as [number, number, number];
                {
                  const mYi  = Number(((m as any).multiplierYi ?? 0));
                  const mBing= Number(((m as any).multiplierBing ?? 0));
                  if ((mYi && mYi > 0) || (mBing && mBing > 0)) {
                    nextLog = [...nextLog, `结算倍数拆分｜对乙x${mYi || 1}｜对丙x${mBing || 1}`];
                  }
                }


                // 若后端没给 winner，依据“地主增减”推断胜负：ds[0] > 0 => 地主胜
                if (nextWinnerLocal == null) {
                  const landlordDeltaSeat = rot2[L] ?? 0;
                  if (landlordDeltaSeat > 0) nextWinnerLocal = L;
                  else if (landlordDeltaSeat < 0) {
                    const farmer = [0,1,2].find(x => x !== L && (rot2[x] ?? 0) > 0);
                    if (typeof farmer === 'number') {
                      nextWinnerLocal = farmer;
                    }
                  }
                }
                nextWinner = nextWinnerLocal;

                // 标记一局结束 & 雷达图兜底
                {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                }

                
                // ✅ Ladder（活动积分 ΔR）：按本局分差幅度加权（独立于胜负方向）
                try {
                  const pre = tsRef.current.map(r => ({ ...r })); // 局前 TS 快照
                  const farmers = [0,1,2].filter(x => x !== L);
                  const farmerWin = (nextWinner === L) ? false : true;
                  const teamWin = (seat:number) => (seat === L) ? (!farmerWin) : farmerWin;
                  const teamP = (seat:number) => {
                    const teamA = (seat === L) ? [L] : farmers;
                    const teamB = (seat === L) ? farmers : [L];
                    const muA = teamA.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const muB = teamB.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const vA  = teamA.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const vB  = teamB.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const c = Math.sqrt(vA + vB);
                    return Phi( (muA - muB) / c );
                  };
                  const mag = Math.max(Math.abs(ds[0]||0), Math.abs(ds[1]||0), Math.abs(ds[2]||0));
                  const base = 20, cap = 3, gamma = 1;
                  const weight = 1 + gamma * Math.min(cap, mag / base);
                  for (let i=0;i<3;i++) {
                    const sWinTeam = teamWin(i) ? 1 : 0;
                    const pExpTeam = teamP(i);
                    const id = seatIdentity(i);
                    const label = agentIdForIndex(i);
                    ladderUpdateLocal(id, label, sWinTeam, pExpTeam, weight, 1);
                  }
                } catch {}
// ✅ TrueSkill：局后更新 + 写入“角色分档”存档
                {
                  const updated = tsRef.current.map(r => ({ ...r }));
                  const farmers = [0,1,2].filter(s => s !== L);
                  const landlordDelta = ds[0] ?? 0;
                  const landlordWin = (nextWinner === L) || (landlordDelta > 0);
                  if (landlordWin) tsUpdateTwoTeams(updated, [L], farmers);
                  else             tsUpdateTwoTeams(updated, farmers, [L]);

                  setTsArr(updated);
                  updateStoreAfterRound(updated, L);

                  nextLog = [
                    ...nextLog,
                    `TS(局后)：甲 μ=${fmt2(updated[0].mu)} σ=${fmt2(updated[0].sigma)}｜乙 μ=${fmt2(updated[1].mu)} σ=${fmt2(updated[1].sigma)}｜丙 μ=${fmt2(updated[2].mu)} σ=${fmt2(updated[2].sigma)}`
                  ];
                }

                nextLog = [
                  ...nextLog,
                  `胜者：${nextWinner == null ? '—' : seatName(nextWinner)}，倍数 x${nextMultiplier}，当局积分（按座位） ${rot.join(' / ')}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`
                ];
                continue;
              }

              // -------- 画像统计（两种形态） --------
              const isStatsTop = (m.type === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              const isStatsEvt = (m.type === 'event' && m.kind === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              if (isStatsTop || isStatsEvt) {
                seenStatsRef.current = true;
                const arr = (m.perSeat ?? m.seats) as any[];
                const s3 = [0,1,2].map(i=>{
                  const rec = arr.find((x:any)=>x.seat===i || x.index===i);
                  const sc = rec?.scaled || rec?.score || {};
                  return {
                    coop: Number(sc.coop ?? 2.5),
                    agg : Number(sc.agg  ?? 2.5),
                    cons: Number(sc.cons ?? 2.5),
                    eff : Number(sc.eff  ?? 2.5),
                    bid : Number(sc.bid ?? 2.5),
                  };
                }) as Score5[];

                // 同步写入 Radar 本地存档（overall + 角色分档）
                updateRadarStoreFromStats(s3, nextLandlord);

                const mode  = aggModeRef.current;
                const a     = alphaRef.current;

                if (!nextAggStats) {
                  nextAggStats = s3.map(x=>({ ...x }));
                  nextAggCount = 1;
                } else {
                  nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                  nextAggCount = nextAggCount + 1;
                }

                const msg = s3.map((v, i)=>`${seatName(i)}：Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜抢地主倾向 ${v.bid}`).join(' ｜ ');
                nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
                continue;
              }

              // -------- 文本日志 --------
              if (m.type === 'log' && typeof m.message === 'string') {
                nextLog = [...nextLog, rewrite(m.message)];
                continue;
              }
            } catch (e) { console.error('[ingest:batch]', e, raw); }
          }

          if (nextLandlord != null && nextBottom.landlord !== nextLandlord) {
            const keep = Array.isArray(nextBottom.cards)
              ? nextBottom.cards.map(c => ({ ...c }))
              : [];
            nextBottom = { landlord: nextLandlord, cards: keep, revealed: !!nextBottom.revealed };
          }

          setRoundLords(nextLords);
          setRoundCuts(nextCuts);
          setScoreSeries(nextScores);
          setScoreBreaks(nextBreaks);
          setHands(nextHands); setPlays(nextPlays);
          setBottomInfo(nextBottom);
          setTotals(nextTotals); setFinishedCount(nextFinished);
          setLog(nextLog); setLandlord(nextLandlord);
          setWinner(nextWinner); setMultiplier(nextMultiplier); setBidMultiplier(nextBidMultiplier); setDelta(nextDelta);
          setAggStats(nextAggStats || null); setAggCount(nextAggCount || 0);
          if (deckAuditChanged) setDeckAudit(nextDeckAudit ?? null);
        }
        if (pauseRef.current) await waitWhilePaused();
      }

    if (dogId) { try { clearInterval(dogId); } catch {} }
    if (roundFinishedRef.current) {
      setFinishedCount(prev => Math.max(prev, labelRoundNo));
    }
    setLog((l:any)=>{
  const __snapshot = [...(Array.isArray(l)?l:[]), `—— 本局流结束 ——`];
  (logRef as any).current = __snapshot;
  setAllLogs((prev:any)=>[...(Array.isArray(prev)?prev:[]), ...__snapshot, `
--- End of Round ${labelRoundNo} ---
`]);
  return __snapshot;
});
};

    const restBetweenRounds = async () => {
      const base = 800 + Math.floor(Math.random() * 600);
      const step = 120;
      let elapsed = 0;
      while (elapsed < base) {
        if (controllerRef.current?.signal.aborted || pauseRef.current) break;
        const slice = Math.min(step, base - elapsed);
        await new Promise(resolve => setTimeout(resolve, slice));
        elapsed += slice;
      }
      if (!controllerRef.current?.signal.aborted) {
        await waitWhilePaused();
      }
    };

    let aborted = false;
    let endedEarlyForNegative = false;
    try {
      for (let i = 0; i < props.rounds; i++) {
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
        const thisRound = i + 1;
        await playOneGame(i, thisRound);
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some(v => (v as number) < 0);
        if (hasNegative) {
          endedEarlyForNegative = true;
          setLog(l => [...l, '【前端】检测到总分 < 0，停止连打。']);
          break;
        }
        await restBetweenRounds();
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') { aborted = true; setLog(l => [...l, '已手动停止。']); }
      else setLog(l => [...l, `错误：${e?.message || e}`]);
    } finally {
      exitPause();
      setRunning(false);
      resetHumanState();
      humanTraceRef.current = '';
      setBotTimers([null, null, null]);
      botCallIssuedAtRef.current = {};
      humanCallIssuedAtRef.current = {};
      humanActiveRequestRef.current = {};
      kimiTpmRef.current = { count: 0, avg: 0, totalTokens: 0, last: undefined };
      setBotClockTs(Date.now());
      const totalsSnap = (() => {
        const value = totalsRef.current;
        if (value && Array.isArray(value) && value.length === 3) {
          return [value[0], value[1], value[2]] as [number, number, number];
        }
        const base = initialTotalsRef.current;
        return [base[0], base[1], base[2]] as [number, number, number];
      })();
      const finishedGames = finishedRef.current || 0;
      const targetRounds = Math.max(1, Number(props.rounds) || 1);
      props.onFinished?.({
        aborted,
        finishedCount: finishedGames,
        totals: totalsSnap,
        completedAll: !aborted && (finishedGames >= targetRounds || endedEarlyForNegative),
        endedEarlyForNegative,
      });
    }
  };

  const stop = () => {
    exitPause();
    controllerRef.current?.abort();
    setRunning(false);
    resetHumanState();
    humanTraceRef.current = '';
    setBotTimers([null, null, null]);
    botCallIssuedAtRef.current = {};
    humanCallIssuedAtRef.current = {};
    humanActiveRequestRef.current = {};
    kimiTpmRef.current = { count: 0, avg: 0, totalTokens: 0, last: undefined };
    setBotClockTs(Date.now());
  };

  const togglePause = () => {
    if (!running) return;
    if (pauseRef.current) exitPause();
    else enterPause();
  };

  useImperativeHandle(ref, () => ({
    start,
    stop,
    togglePause,
    isRunning: () => runningRef.current,
    isPaused: () => pauseRef.current,
    getInstanceId: () => instanceIdRef.current,
  }));

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  const controlsContent = (
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
      <button
        onClick={start}
        disabled={running}
        style={{
          padding:'8px 12px',
          borderRadius:8,
          border:'1px solid #d1d5db',
          background: running ? '#f3f4f6' : '#2563eb',
          color: running ? '#9ca3af' : '#fff',
          cursor: running ? 'not-allowed' : 'pointer',
          fontWeight:600,
        }}
      >开始</button>
      <button
        onClick={togglePause}
        disabled={!running}
        style={{
          padding:'8px 12px',
          borderRadius:8,
          border:'1px solid #d1d5db',
          background: !running ? '#f3f4f6' : (paused ? '#bfdbfe' : '#fde68a'),
          color: !running ? '#9ca3af' : (paused ? '#1e3a8a' : '#92400e'),
          cursor: !running ? 'not-allowed' : 'pointer',
          fontWeight:600,
        }}
      >{paused ? '继续' : '暂停'}</button>
      <button
        onClick={stop}
        disabled={!running}
        style={{
          padding:'8px 12px',
          borderRadius:8,
          border:'1px solid #d1d5db',
          background: running ? '#fee2e2' : '#f3f4f6',
          color: running ? '#b91c1c' : '#9ca3af',
          cursor: running ? 'pointer' : 'not-allowed',
          fontWeight:600,
        }}
      >停止</button>
      <span style={{ display:'inline-flex', alignItems:'center', padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
        剩余局数：{remainingGames}
      </span>
    </div>
  );

  let controlsNode: ReactNode = null;
  if (!props.controlsHidden) {
    if (props.controlsPortal) {
      controlsNode = renderViaPortal(controlsContent, props.controlsPortal);
    } else if (typeof props.controlsPortal === 'undefined') {
      controlsNode = controlsContent;
    }
  }

  // ===== 统一统计打包（All-in-One） =====
type AllBundle = {
  schema: 'ddz-all@1';
  createdAt: string;
  identities: string[];
  trueskill?: TsStore;
  /* radar?: RadarStore;  // disabled */
  ladder?: { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, any> };
  latency?: ThoughtStore;
};

const buildAllBundle = (): AllBundle => {
  const identities = [0,1,2].map(seatIdentity);
  let ladder: any = null;
  try {
    const raw = localStorage.getItem('ddz_ladder_store_v1');
    ladder = raw ? JSON.parse(raw) : null;
  } catch {}
  const latency = thoughtStoreRef.current ? ensureThoughtStore(thoughtStoreRef.current) : ensureThoughtStore(THOUGHT_EMPTY);
  return {
    schema: 'ddz-all@1',
    createdAt: new Date().toISOString(),
    identities,
    trueskill: tsStoreRef.current,
    /* radar excluded */
    ladder,
    latency,
  };
};

const applyAllBundleInner = (obj:any) => {
  try {
    if (obj?.trueskill?.players) {
      tsStoreRef.current = obj.trueskill as TsStore;
      writeStore(tsStoreRef.current);
    }
    // radar ignored for ALL upload (persistence disabled)

    if (obj?.ladder?.schema === 'ddz-ladder@1') {
      try { localStorage.setItem('ddz_ladder_store_v1', JSON.stringify(obj.ladder)); } catch {}
    }
    if (obj?.latency) {
      const sanitized = ensureThoughtStore(obj.latency);
      const persisted = writeThoughtStore(sanitized);
      thoughtStoreRef.current = persisted;
      setThoughtStore(persisted);
      setLastThoughtMs([null, null, null]);
    }
    setLog(l => [...l, '【ALL】统一上传完成（TS / 画像 / 天梯 / 思考时延）。']);
  } catch (e:any) {
    setLog(l => [...l, `【ALL】统一上传失败：${e?.message || e}`]);
  }
};
const handleAllSaveInner = () => {
    const payload = buildAllBundle();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = makeArchiveName('.json'); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    setLog(l => [...l, '【ALL】已导出统一统计文件。']);
  };

  

  const handleAllRefreshInner = () => {
    applyTsFromStoreByRole(landlordRef.current, '手动刷新');
    applyRadarFromStoreByRole(landlordRef.current, '手动刷新');
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setScoreBreaks(prev => [...prev]);
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
    const refreshedLatency = readThoughtStore();
    thoughtStoreRef.current = refreshedLatency;
    setThoughtStore(refreshedLatency);
    setLastThoughtMs([null, null, null]);
    setLog(l => [...l, '【ALL】已刷新面板数据。']);
  };

  useEffect(()=>{
    const onSave = () => handleAllSaveInner();
    const onRefresh = () => handleAllRefreshInner();
    const onUpload = (e: Event) => {
      const ce = e as CustomEvent<any>;
      applyAllBundleInner(ce.detail);
    };
    window.addEventListener('ddz-all-save', onSave as any);
    window.addEventListener('ddz-all-refresh', onRefresh as any);
    window.addEventListener('ddz-all-upload', onUpload as any);
    return () => {
      window.removeEventListener('ddz-all-save', onSave as any);
      window.removeEventListener('ddz-all-refresh', onRefresh as any);
      window.removeEventListener('ddz-all-upload', onUpload as any);
    };
  }, []);

  return (
    <SeatInfoContext.Provider value={seatDisplayNames}>
      <div>
      {controlsNode}

      <ThoughtSummaryPanel stats={thoughtStore} lastMs={lastThoughtMs} identities={seatIdentitiesMemo} lang={lang} />

      {/* ========= TrueSkill（实时） ========= */}
      <Section title="TrueSkill（实时）">
        {/* 上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
<div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>{
            const stored = getStoredForSeat(i);
            const usingRole: 'overall'|'landlord'|'farmer' =
              landlord==null ? 'overall' : (landlord===i ? 'landlord' : 'farmer');
            const seatIsHuman = isHumanSeat(i);
            const timer = seatIsHuman ? null : botTimers[i];
            let timerDisplay: ReactNode = null;
            if (timer) {
              const remainingMs = Math.max(0, timer.expiresAt - botClockTs);
              const expired = remainingMs <= 0;
              const seconds = Math.ceil(remainingMs / 1000);
              const phaseLabel = timer.phase === 'bid'
                ? (lang === 'en' ? 'Bidding' : '抢地主')
                : timer.phase === 'double'
                  ? (lang === 'en' ? 'Double' : '加倍')
                  : (lang === 'en' ? 'Play' : '出牌');
              const text = expired
                ? (lang === 'en'
                  ? 'Time expired. Waiting for auto action…'
                  : '已超时，等待系统自动处理…')
                : (lang === 'en'
                  ? `Time left: ${seconds}s (${phaseLabel})`
                  : `剩余时间：${seconds}秒（${phaseLabel}）`);
              timerDisplay = (
                <div style={{ fontSize:12, color: expired ? '#dc2626' : '#2563eb', marginBottom:6 }}>
                  {text}
                </div>
              );
            }
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
                <div style={{ marginBottom:6 }}>
                  <SeatTitle i={i} landlord={landlord === i} />
                </div>
                {timerDisplay}
                <div style={{ fontSize:13, color:'#374151' }}>
                  <div>μ：<b>{fmt2(tsArr[i].mu)}</b></div>
                  <div>σ：<b>{fmt2(tsArr[i].sigma)}</b></div>
                  <div>CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b></div>
                </div>

                {/* 区分显示总体/地主/农民三档，并标注当前使用 */}
                <div style={{ borderTop:'1px dashed #eee', marginTop:8, paddingTop:8 }}>
                  <div style={{ fontSize:12, marginBottom:6 }}>
                    当前使用：<b>
                      {usingRole === 'overall' ? '总体档' : usingRole === 'landlord' ? '地主档' : '农民档'}
                    </b>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, fontSize:12, color:'#374151' }}>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>总体</div>
                      <div>{muSig(stored.overall)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>地主</div>
                      <div>{muSig(stored.landlord)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>农民</div>
                      <div>{muSig(stored.farmer)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>
          说明：CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。</div>
      </Section>

      {/* ======= 积分下面、手牌上面：雷达图 ======= */}
      <Section title="战术画像（累计，0~5）">
        {/* Radar：上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
<div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <RadarPanel
          aggStats={aggStats}
          aggCount={aggCount}
          aggMode={aggMode}
          alpha={alpha}
          onChangeMode={setAggMode}
          onChangeAlpha={setAlpha}
        />
      </Section>

      
      <Section title="出牌评分（每局动态）">
        
<div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>每局开始底色按“本局地主”的线色淡化显示；上传文件可替换/叠加历史，必要时点“刷新”。</div>
        <ScoreTimeline
          series={scoreSeries}
          bands={roundCuts}
          landlords={roundLords}
          breaks={scoreBreaks}
          labels={[0,1,2].map(i=>agentIdForIndex(i))}
          height={240}
        />
      </Section>
      <div style={{ marginTop:10 }}></div>
      <Section title="评分统计（每局汇总）">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[0,1,2].map(i=>{
            const st = scoreStats[i];
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fff' }}>
                <div style={{ marginBottom:6 }}><SeatTitle i={i} /></div>
                <div style={{ fontSize:12, color:'#6b7280' }}>局数：{st.rounds}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>总体均值：{st.overallAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最近一局均值：{st.lastAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最好局均值：{st.best.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最差局均值：{st.worst.toFixed(3)}</div>
                {/* 分布曲线（每局均值的分布） */}
                
                {/* 分布直方图（每手score汇总：横轴=score，纵轴=频次；固定20桶） */}
                {(() => {
                  const samples = (scoreSeries[i] || []).filter(v => typeof v === 'number' && !Number.isNaN(v)) as number[];
                  if (!samples.length) return null;
                  const pad = 6, W = 220, H = 72;
                  // μ & σ 基于所有出牌评分样本
                  const mu = samples.reduce((a,b)=>a+b,0) / samples.length;
                  const sg = Math.sqrt(Math.max(0, samples.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / samples.length));
                  // 固定20桶
                  const bins = 20;
                  const lo = Math.min(...samples);
                  const hi0 = Math.max(...samples);
                  const hi = hi0===lo ? lo + 1 : hi0; // 防零宽
                  const x = (v:number)=> pad + (hi>lo ? (v-lo)/(hi-lo) : 0.5) * (W - 2*pad);
                  const barW = (W - 2*pad) / bins;
                  // 计数
                  const counts = new Array(bins).fill(0);
                  for (const v of samples) {
                    let k = Math.floor((v - lo) / (hi - lo) * bins);
                    if (k < 0) k = 0; if (k >= bins) k = bins - 1;
                    counts[k]++;
                  }
                  const binWidthVal = (hi - lo) / bins;
                  const densities = counts.map(c => c / (samples.length * (binWidthVal || 1)));
                  const maxD = Math.max(...densities) || 1;
                  const bars = densities.map((d, k) => {
                    const x0 = pad + k * barW + 0.5;
                    const h = (H - 2*pad) * (d / maxD);
                    const y0 = H - pad - h;
                    return <rect key={k} x={x0} y={y0} width={Math.max(1, barW - 1)} height={Math.max(0, h)} fill="#9ca3af" opacity={0.45} />;
                  });
                  // μ & ±1σ 标注
                  const meanX = x(mu);
                  const sigL = x(mu - sg);
                  const sigR = x(mu + sg);
                  return (
                    <svg width={W} height={H} style={{ display:'block', marginTop:6 }}>
                      <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#e5e7eb"/>
                      {bars}
                      <line x1={meanX} y1={pad} x2={meanX} y2={H-pad} stroke="#ef4444" strokeDasharray="4 3" />
                      <line x1={sigL} y1={pad} x2={sigL} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <line x1={sigR} y1={pad} x2={sigR} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <text x={meanX+4} y={12} fontSize={10} fill="#ef4444">μ={mu.toFixed(2)}</text>
                      <text x={sigL+4} y={24} fontSize={10} fill="#60a5fa">-1σ</text>
                      <text x={sigR+4} y={24} fontSize={10} fill="#60a5fa">+1σ</text>
                    </svg>
                  );
                })()}
        
              </div>
            );
          })}
        </div>
      </Section>

      {deckAudit && (() => {
        const totalOk = deckAudit.total === deckAudit.expectedTotal;
        const hasDuplicates = deckAudit.duplicates.length > 0;
        const hasMissing = deckAudit.missing.length > 0;
        const hasIssue = !totalOk || hasDuplicates || hasMissing;
        const seatCounts = deckAudit.perSeat.map((count, idx) =>
          lang === 'en'
            ? `${seatLabel(idx, lang)}: ${count}`
            : `${seatLabel(idx, lang)}：${count}`
        );
        const bottomLabel = lang === 'en' ? 'Bottom' : '底牌';
        const ownerName = (owner: DeckOwner) => owner.type === 'seat'
          ? seatLabel(owner.seat, lang)
          : bottomLabel;
        return (
          <Section title={lang === 'en' ? 'Deck integrity check' : '牌局完整性检查'}>
            <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12, color:'#374151' }}>
              <div style={{ color: totalOk ? '#065f46' : '#b91c1c', fontWeight:600 }}>
                {lang === 'en'
                  ? `Total cards: ${deckAudit.total} / ${deckAudit.expectedTotal}`
                  : `总牌数：${deckAudit.total} / ${deckAudit.expectedTotal}`}
              </div>
              <div>
                {lang === 'en'
                  ? `Initial distribution — ${seatCounts.join(' · ')} · ${bottomLabel}: ${deckAudit.bottom}`
                  : `开局统计：${seatCounts.join(' ｜ ')} ｜ ${bottomLabel}：${deckAudit.bottom}`}
              </div>
              {hasDuplicates && (
                <div style={{ color:'#b91c1c' }}>
                  {lang === 'en' ? 'Duplicates:' : '重复牌：'}
                  <ul style={{ margin:'4px 0 0 18px', padding:0 }}>
                    {deckAudit.duplicates.map((dup, idx) => (
                      <li key={`${dup.key}-${idx}`} style={{ listStyle:'disc' }}>
                        {deckKeyDisplay(dup.key)} → {dup.owners.map(ownerName).join(lang === 'en' ? ', ' : '、')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hasMissing && (
                <div style={{ color:'#b91c1c' }}>
                  {lang === 'en'
                    ? `Missing cards: ${deckAudit.missing.map(deckKeyDisplay).join(', ')}`
                    : `缺失牌：${deckAudit.missing.map(deckKeyDisplay).join('、')}`}
                </div>
              )}
              {!hasIssue && (
                <div style={{ color:'#16a34a', fontWeight:600 }}>
                  {lang === 'en'
                    ? 'Deck verified: all 54 unique cards accounted for.'
                    : '校验通过：54 张牌均唯一。'}
                </div>
              )}
              <div style={{ fontSize:11, color:'#6b7280' }}>
                {lang === 'en'
                  ? `Checked at ${new Date(deckAudit.timestamp).toLocaleTimeString()}`
                  : `校验时间：${new Date(deckAudit.timestamp).toLocaleTimeString('zh-CN')}`}
              </div>
            </div>
          </Section>
        );
      })()}

      <Section title="手牌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {[0,1,2].map(i => {
            const isHumanTurn = !!(humanRequest && humanRequest.seat === i && humanRequest.phase === 'play');
            const seatInteractive = isHumanTurn && !humanExpired;
            const revealActive = handRevealRef.current[i] > Date.now();
            const faceDown = revealActive ? false : (hasHumanSeat ? !isHumanSeat(i) : false);
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, position:'relative' }}>
                <div
                  style={{
                    position:'absolute',
                    top:8,
                    right:8,
                    fontSize:16,
                    fontWeight:800,
                    background:'#fff',
                    border:'1px solid #eee',
                    borderRadius:6,
                    padding:'2px 6px',
                  }}
                >
                  {totals[i]}
                </div>
                <div style={{ marginBottom:6 }}>
                  <SeatTitle i={i} landlord={landlord === i} />
                </div>
                <Hand
                  cards={hands[i]}
                  interactive={seatInteractive}
                  selectedIndices={humanRequest && humanRequest.seat === i ? humanSelectedSet : undefined}
                  onToggle={seatInteractive ? toggleHumanCard : undefined}
                  disabled={humanSubmitting || humanExpired}
                  faceDown={faceDown}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginTop:8 }}>
          {[0,1,2].map(i=>{
            const isRevealed = !!bottomInfo.revealed;
            const isLandlord = bottomInfo.landlord === i;
            const showCards = isRevealed && isLandlord;
            const cards = showCards ? bottomInfo.cards : [];
            const labelText = lang === 'en'
              ? (isRevealed ? 'Bottom' : 'Bottom (awaiting reveal)')
              : (isRevealed ? '底牌' : '底牌（待明牌）');
            const background = isRevealed
              ? (isLandlord ? '#f0fdf4' : '#f9fafb')
              : '#f9fafb';
            return (
              <div
                key={`bottom-${i}`}
                style={{
                  border:'1px dashed #d1d5db',
                  borderRadius:8,
                  padding:'6px 8px',
                  minHeight:64,
                  display:'flex',
                  flexDirection:'column',
                  justifyContent:'center',
                  alignItems:'center',
                  background
                }}
              >
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>{labelText}</div>
                {showCards ? (
                  cards.length ? (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, justifyContent:'center' }}>
                      {cards.map((c, idx) => (
                        <Card key={`${c.label}-${idx}`} label={c.label} dimmed={c.used} compact />
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize:12, color:'#9ca3af' }}>
                      {lang === 'en' ? '(awaiting reveal)' : '（待明牌）'}
                    </div>
                  )
                ) : isRevealed ? (
                  <div style={{ fontSize:12, color:'#d1d5db' }}>—</div>
                ) : (
                  <div style={{ fontSize:12, color:'#9ca3af' }}>
                    {lang === 'en' ? '(awaiting reveal)' : '（待明牌）'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {humanRequest && (
        <Section title={lang === 'en' ? 'Human control' : '人类操作'}>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ fontWeight:700 }}>
              {lang === 'en'
                ? `Seat ${humanSeatLabel} · ${humanPhaseText}`
                : `${humanSeatLabel} ｜ ${humanPhaseText}`}
            </div>
            {humanCountdownText && (
              <div style={{ fontSize:12, color: humanExpired ? '#dc2626' : '#1d4ed8' }}>
                {humanCountdownText}
              </div>
            )}
            {humanLagDisplay && (
              <div style={{ fontSize:12, color:'#6b7280' }}>{humanLagDisplay}</div>
            )}
            {humanExpirationNotice && (
              <div style={{ fontSize:12, color:'#dc2626' }}>{humanExpirationNotice}</div>
            )}
            {humanPhase === 'play' && (
              <>
                <div style={{ fontSize:12, color:'#6b7280' }}>
                  {lang === 'en'
                    ? `Requirement: ${humanRequireText} · Can pass: ${humanCanPass ? 'Yes' : 'No'} · Selected: ${humanSelectedCount}`
                    : `需求：${humanRequireText} ｜ 可过：${humanCanPass ? '是' : '否'} ｜ 已选：${humanSelectedCount}`}
                </div>
                {humanMustPass && (
                  <div style={{ fontSize:12, color:'#dc2626' }}>
                    {lang === 'en'
                      ? 'No playable cards available. Please pass this turn.'
                      : '无牌可出，请选择过牌。'}
                  </div>
                )}
                {humanHint && (
                  <div
                    style={{
                      border:'1px solid #bfdbfe',
                      background:'#eff6ff',
                      borderRadius:8,
                      padding:'8px 10px',
                      display:'flex',
                      flexDirection:'column',
                      gap:6,
                    }}
                  >
                    <div style={{ fontWeight:600, color:'#1d4ed8' }}>
                      {lang === 'en'
                        ? (humanHint.move === 'play' ? 'Suggestion: play these cards' : 'Suggestion: pass this turn')
                        : (humanHint.move === 'play' ? '提示：建议出牌' : '提示：建议过牌')}
                    </div>
                    {humanHint.move === 'play' ? (
                      humanHintDecorated.length > 0 ? (
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                          {humanHintDecorated.map((card, idx) => (
                            <Card key={`hint-${card}-${idx}`} label={card} compact />
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:'#4b5563' }}>
                          {humanHint.valid === false
                            ? (lang === 'en'
                              ? 'Suggestion ignored because cards are missing from your hand.'
                              : '提示包含不在手牌中的牌，已忽略。')
                            : (lang === 'en'
                              ? 'No specific combination suggested; choose any legal play.'
                              : '暂无具体牌型建议，可根据规则自由选择。')}
                        </div>
                      )
                    ) : (
                      <div style={{ fontSize:12, color:'#4b5563' }}>
                        {lang === 'en'
                          ? 'Hint: passing keeps stronger responses for later.'
                          : '提示：建议过牌以保留更强的牌型。'}
                      </div>
                    )}
                    {humanHintMeta.length > 0 && (
                      <div style={{ fontSize:12, color:'#4b5563' }}>
                        {humanHintMeta.join(lang === 'en' ? ' · ' : ' ｜ ')}
                      </div>
                    )}
                    {canAdoptHint && (
                      <div>
                        <button
                          onClick={applyHumanHint}
                          disabled={humanSubmitting || humanExpired}
                          style={{
                            padding:'4px 10px',
                            border:'1px solid #3b82f6',
                            borderRadius:6,
                            background: humanSubmitting || humanExpired ? '#dbeafe' : '#3b82f6',
                            color: humanSubmitting || humanExpired ? '#6b7280' : '#fff',
                          }}
                        >
                          {lang === 'en' ? 'Adopt suggestion' : '采纳建议'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  <button
                    onClick={handleHumanPlay}
                    disabled={humanSubmitting || humanSelectedCount === 0 || humanMustPass || humanExpired}
                    style={{
                      padding:'6px 12px',
                      border:'1px solid #2563eb',
                      borderRadius:8,
                      background: humanSubmitting || humanSelectedCount === 0 || humanMustPass || humanExpired ? '#e5e7eb' : '#2563eb',
                      color: humanSubmitting || humanSelectedCount === 0 || humanMustPass || humanExpired ? '#6b7280' : '#fff',
                    }}
                  >{lang === 'en' ? 'Play selected' : '出牌'}</button>
                  <button
                    onClick={handleHumanPass}
                    disabled={humanSubmitting || !humanCanPass || humanExpired}
                    style={{
                      padding:'6px 12px',
                      border:'1px solid #d1d5db',
                      borderRadius:8,
                      background: humanMustPass ? '#fee2e2' : (humanSubmitting || !humanCanPass || humanExpired ? '#f3f4f6' : '#fff'),
                      color: humanMustPass ? '#b91c1c' : '#1f2937',
                    }}
                  >{lang === 'en' ? 'Pass' : '过'}</button>
                  <button
                    onClick={handleHumanClear}
                    disabled={humanSubmitting || humanSelectedCount === 0 || humanExpired}
                    style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background: humanSubmitting || humanExpired ? '#f3f4f6' : '#fff', color:'#1f2937' }}
                  >{lang === 'en' ? 'Clear selection' : '清空选择'}</button>
                </div>
              </>
            )}
            {humanPhase === 'bid' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                <button
                  onClick={() => handleHumanBid(true)}
                  disabled={humanSubmitting || humanExpired}
                  style={{ padding:'6px 12px', border:'1px solid #2563eb', borderRadius:8, background: humanSubmitting || humanExpired ? '#e5e7eb' : '#2563eb', color: humanSubmitting || humanExpired ? '#6b7280' : '#fff' }}
                >{lang === 'en' ? 'Bid' : '抢地主'}</button>
                <button
                  onClick={() => handleHumanBid(false)}
                  disabled={humanSubmitting || humanExpired}
                  style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background: humanSubmitting || humanExpired ? '#f3f4f6' : '#fff', color:'#1f2937' }}
                >{lang === 'en' ? 'Pass' : '不抢'}</button>
              </div>
            )}
            {humanPhase === 'double' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                <button
                  onClick={() => handleHumanDouble(true)}
                  disabled={humanSubmitting || humanExpired}
                  style={{ padding:'6px 12px', border:'1px solid #2563eb', borderRadius:8, background: humanSubmitting || humanExpired ? '#e5e7eb' : '#2563eb', color: humanSubmitting || humanExpired ? '#6b7280' : '#fff' }}
                >{lang === 'en' ? 'Double' : '加倍'}</button>
                <button
                  onClick={() => handleHumanDouble(false)}
                  disabled={humanSubmitting || humanExpired}
                  style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background: humanSubmitting || humanExpired ? '#f3f4f6' : '#fff', color:'#1f2937' }}
                >{lang === 'en' ? 'No double' : '不加倍'}</button>
              </div>
            )}
            {humanError && (
              <div style={{ color:'#dc2626', fontSize:12 }}>{humanError}</div>
            )}
            {humanSubmitting && (
              <div style={{ color:'#2563eb', fontSize:12 }}>
                {lang === 'en' ? 'Submitted. Waiting for engine...' : '已提交，等待引擎响应…'}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="出牌">
        <div style={{ border:'1px dashed #eee', borderRadius:8, padding:'6px 8px' }}>
          {plays.length === 0
            ? <div style={{ opacity:0.6 }}>（尚无出牌）</div>
            : plays.map((p, idx) => (
              <PlayRow
                key={idx}
                seat={p.seat}
                move={p.move}
                cards={p.cards}
                reason={p.reason}
                showReason={canDisplaySeatReason(p.seat)}
              />
            ))
          }
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>叫抢倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{bidMultiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>对局倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>胜者</div>
            <div style={{ marginTop:6 }}>
              {winner == null ? (
                <div style={{ fontSize:24, fontWeight:800 }}>—</div>
              ) : (
                <div style={{ fontSize:18 }}>
                  <SeatTitle i={winner} landlord={landlord === winner} />
                </div>
              )}
            </div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
        </div>
      </Section>
<div style={{ marginTop:18 }}>
        <Section title="">
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
    <div style={{ fontWeight:700 }}>运行日志</div>
    <button
      onClick={() => { try { const lines=(allLogsRef.current||[]) as string[]; const ts=new Date().toISOString().replace(/[:.]/g,'-'); const text=lines.length?lines.join('\n'):'（暂无）'; const blob=new Blob([text],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`run-log_${ts}.txt`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200);} catch(e){ console.error('[runlog] save error', e); } }}
      style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>

<div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px', maxHeight:420, overflow:'auto', background:'#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity:0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        
</Section>
      </div>
    </div>
    </SeatInfoContext.Provider>
  );
});

/* ========= 默认值（含“清空”按钮的重置） ========= */
const DEFAULTS = {
  enabled: true,
  bid: true,
  rounds: 10,
  startScore: 100,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000,1000,1000] as number[],
  seats: ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  // 让选择提供商时自动写入推荐模型；避免初始就带上 OpenAI 的模型名
  seatModels: ['', '', ''],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],};

function Home() {
  // Ensure language applies before paint on refresh
  useLayoutEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const v = localStorage.getItem('ddz_lang');
        if (v === 'en' || v === 'zh') {
          if (v !== lang) setLang(v as Lang);
          if (typeof document !== 'undefined') document.documentElement.lang = v;
        }
      }
    } catch {}
  }, []);

const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'zh';
    const v = localStorage.getItem('ddz_lang');
    return (v === 'en' || v === 'zh') ? (v as Lang) : 'zh';
  });
  const [matchMode, setMatchMode] = useState<'regular'|'knockout'>(() => {
    if (typeof window === 'undefined') return 'regular';
    const v = localStorage.getItem('ddz_match_mode');
    return v === 'knockout' ? 'knockout' : 'regular';
  });
  const humanOptionLabel = lang === 'en' ? 'Human' : '人类选手';
  useEffect(()=>{
    try {
      localStorage.setItem('ddz_lang', lang);
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
    } catch {}
  }, [lang]);
  useEffect(() => {
    try { localStorage.setItem('ddz_match_mode', matchMode); } catch {}
  }, [matchMode]);
  const mainRef = useRef<HTMLDivElement | null>(null);
  useEffect(()=>{ try { if (typeof document !== 'undefined') autoTranslateContainer(mainRef.current, lang); } catch {} }, [lang]);


  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);

  const [turnTimeoutSec, setTurnTimeoutSec] = useState<number>(30);

  const [bid, setBid] = useState<boolean>(DEFAULTS.bid);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i:number, v:number|string) => setSeatDelayMs(arr => { const n=[...arr]; n[i]=Math.max(0, Math.floor(Number(v)||0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState(DEFAULTS.seatKeys);
  const [totalMatches, setTotalMatches] = useState<number | null>(null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [developerJoinOpen, setDeveloperJoinOpen] = useState(false);
  const [blogOpen, setBlogOpen] = useState(false);
  const [discordOpen, setDiscordOpen] = useState(false);
  const disclaimerHostRef = useRef<HTMLElement | null>(null);

  const computeTotalMatches = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('ddz_ladder_store_v1');
      if (!raw) {
        setTotalMatches(0);
        return;
      }
      const store = JSON.parse(raw) || {};
      const players = (store?.players && typeof store.players === 'object') ? store.players as Record<string, any> : {};
      let total = 0;
      for (const key of Object.keys(players)) {
        const entry = players[key];
        if (!entry) continue;
        const matches = entry?.current?.matches;
        if (typeof matches === 'number' && Number.isFinite(matches)) {
          total += Math.max(0, Math.round(matches));
          continue;
        }
        const fallback = entry?.current?.n;
        if (typeof fallback === 'number' && Number.isFinite(fallback)) {
          total += Math.max(0, Math.round(fallback));
        }
      }
      setTotalMatches(total);
    } catch {
      setTotalMatches(0);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => { computeTotalMatches(); };
    handler();
    window.addEventListener('ddz-all-refresh', handler as any);
    const interval = window.setInterval(handler, 2000);
    return () => {
      window.removeEventListener('ddz-all-refresh', handler as any);
      window.clearInterval(interval);
    };
  }, [computeTotalMatches]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let host = document.getElementById('ddz-disclaimer-root') as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.id = 'ddz-disclaimer-root';
      document.body.appendChild(host);
    }
    disclaimerHostRef.current = host;
    return () => {
      if (!host) return;
      if (host.childElementCount === 0) {
        host.remove();
      }
    };
  }, []);

  const disclaimerContent = useMemo(() => {
    return DISCLAIMER_CONTENT[lang] ?? DISCLAIMER_CONTENT.zh;
  }, [lang]);
  const developerJoinContent = useMemo(() => {
    return DEVELOPER_JOIN_CONTENT[lang] ?? DEVELOPER_JOIN_CONTENT.zh;
  }, [lang]);
  const blogContent = useMemo(() => {
    const content = BLOG_CONTENT[lang] ?? BLOG_CONTENT.zh;
    const sortedPosts = Array.isArray(content.posts)
      ? [...content.posts].sort((a, b) => {
          const timeA = new Date(a.date).getTime();
          const timeB = new Date(b.date).getTime();
          if (!Number.isFinite(timeA) && !Number.isFinite(timeB)) return 0;
          if (!Number.isFinite(timeA)) return 1;
          if (!Number.isFinite(timeB)) return -1;
          return timeB - timeA;
        })
      : [];
    return { ...content, posts: sortedPosts };
  }, [lang]);
  const discordContent = useMemo(() => {
    return DISCORD_CONTENT[lang] ?? DISCORD_CONTENT.zh;
  }, [lang]);

  const seatInfoLabels = useMemo(() => {
    return [0,1,2].map(i => {
      const choice = seats[i] as BotChoice;
      if (!choice) return '';
      const modelInput = Array.isArray(seatModels) ? seatModels[i] : '';
      const normalizedModel = normalizeModelForProvider(choice, modelInput || '')
        || (modelInput || defaultModelFor(choice));
      const base = choice === 'http' ? (seatKeys?.[i]?.httpBase || '') : '';
      const identity = makeThoughtIdentity(choice, normalizedModel, base);
      const label = thoughtLabelForIdentity(identity);
      return label || '';
    });
  }, [seats, seatModels, seatKeys]);

  const [liveLog, setLiveLog] = useState<string[]>([]);
  const liveLogRef = useRef<string[]>(liveLog);
  useEffect(() => { liveLogRef.current = liveLog; }, [liveLog]);
  const [ladderControlsHost, setLadderControlsHost] = useState<HTMLDivElement | null>(null);
  const ladderControlsHostRef = useCallback((el: HTMLDivElement | null) => {
    setLadderControlsHost(el);
  }, []);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setBid(DEFAULTS.bid); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({ ...x })));
    setLiveLog([]); setResetKey(k => k + 1);
    try { localStorage.removeItem('ddz_ladder_store_v1'); } catch {}
    try { localStorage.removeItem('ddz_latency_store_v1'); } catch {}
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  };

  const handleRegularFinished = useCallback((result: LivePanelFinishPayload) => {
    if (!result || result.aborted) return;
    if (!(result.completedAll || result.endedEarlyForNegative)) return;
    const lines = (liveLogRef.current || []).map(line => String(line));
    const seatMeta = seats.slice(0, 3).map((choice, idx) => ({
      seatIndex: idx,
      label: seatInfoLabels[idx] || seatLabel(idx, lang),
      choice,
      model: seatModels[idx] || '',
      httpBase: seatKeys[idx]?.httpBase || '',
      human: choice === 'human',
    }));
    const summary = lang === 'en'
      ? `Regular · ${rounds} round(s)`
      : `常规赛 · ${rounds} 局`;
    const metadata = {
      summary,
      timestamp: new Date().toISOString(),
      roundsRequested: rounds,
      finishedCount: result.finishedCount,
      totals: result.totals,
      endedEarly: !!result.endedEarlyForNegative,
      startScore,
      farmerCoop,
      bid,
      four2,
      seatDelaysMs: seatDelayMs,
      turnTimeoutSecs,
      seatMeta,
    };
    const runId = `regular-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    void postRunLogDelivery({
      runId,
      mode: 'regular',
      logLines: lines,
      metadata,
    });
  }, [bid, farmerCoop, four2, lang, rounds, seatDelayMs, seatKeys, seatModels, seats, seatInfoLabels, startScore, turnTimeoutSecs]);
  // —— 统一统计（TS + Radar + 出牌评分 + 评分统计）外层上传入口 ——
  const allFileRef = useRef<HTMLInputElement|null>(null);
  const handleAllFileUploadHome = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(String(rd.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    rd.readAsText(f);
  };
  const isRegularMode = matchMode === 'regular';
  const regularLabel = lang === 'en' ? 'Regular match' : '常规赛';
  const knockoutLabel = lang === 'en' ? 'Knockout' : '淘汰赛';
  return (<>
    <LangContext.Provider value={lang}>
      <SeatInfoContext.Provider value={seatInfoLabels}>
        <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }} ref={mainRef} key={lang}>
          <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 8px', textAlign:'center' }}>斗地主 · Fight the Landlord</h1>
          <div style={{ textAlign:'center', marginBottom:16 }}>
            <span
              style={{
                display:'inline-block',
                padding:'4px 12px',
                borderBottom:'2px solid #ef4444',
                fontSize:16,
                fontWeight:700,
              }}
            >
              {(() => {
                const formatted = totalMatches != null ? totalMatches.toLocaleString() : '—';
                return lang === 'en'
                  ? `${I18N.en.TotalMatches}: ${formatted}`
                  : `${I18N.zh.TotalMatches}：${formatted}`;
              })()}
            </span>
          </div>
          <div style={{ marginLeft:'auto', marginBottom:24, display:'flex', flexDirection:'column', alignItems:'stretch', gap:12 }} data-i18n-ignore>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span aria-hidden="true" title={lang==='en'?'Language':'语言'} style={{ fontSize:14, opacity:0.75, display:'inline-flex', alignItems:'center' }}>🌐</span>
              <select aria-label={lang==='en'?'Language':'语言'} value={lang} onChange={e=>setLang((e.target.value as Lang))} style={{ padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                <DonationWidget lang={lang} />
                <button
                  type="button"
                  onClick={() => { setDisclaimerOpen(true); setDeveloperJoinOpen(false); setBlogOpen(false); setDiscordOpen(false); }}
                  style={{
                    padding:'6px 16px',
                    borderRadius:999,
                    border:'1px solid #dc2626',
                    background:'#fee2e2',
                    color:'#b91c1c',
                    fontWeight:600,
                    cursor:'pointer',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >
                  {lang === 'en' ? I18N.en.DisclaimerButton : I18N.zh.DisclaimerButton}
                </button>
                <button
                  type="button"
                  onClick={() => { setDeveloperJoinOpen(true); setDisclaimerOpen(false); setBlogOpen(false); setDiscordOpen(false); }}
                  style={{
                    padding:'6px 16px',
                    borderRadius:999,
                    border:'1px solid #2563eb',
                    background:'#eff6ff',
                    color:'#1d4ed8',
                    fontWeight:600,
                    cursor:'pointer',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.08)',
                  }}
                >
                  {lang === 'en' ? I18N.en.DeveloperJoinButton : I18N.zh.DeveloperJoinButton}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscordOpen(true);
                    setDisclaimerOpen(false);
                    setDeveloperJoinOpen(false);
                    setBlogOpen(false);
                  }}
                  style={{
                    padding:'6px 16px',
                    borderRadius:999,
                    border:'1px solid #6366f1',
                    background:'#eef2ff',
                    color:'#4338ca',
                    fontWeight:600,
                    cursor:'pointer',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.08)',
                  }}
                >
                  {lang === 'en' ? I18N.en.DiscordButton : I18N.zh.DiscordButton}
                </button>
                <button
                  type="button"
                  onClick={() => { setBlogOpen(true); setDisclaimerOpen(false); setDeveloperJoinOpen(false); setDiscordOpen(false); }}
                  style={{
                    padding:'6px 16px',
                    borderRadius:999,
                    border:'1px solid #d97706',
                    background:'#fef3c7',
                    color:'#b45309',
                    fontWeight:600,
                    cursor:'pointer',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  {lang === 'en' ? I18N.en.BlogButton : I18N.zh.BlogButton}
                </button>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                <button
                  onClick={()=>setMatchMode('regular')}
                  aria-pressed={isRegularMode}
                  style={{
                    padding:'6px 12px',
                    borderRadius:8,
                    border:'1px solid #d1d5db',
                    background: isRegularMode ? '#2563eb' : '#fff',
                    color: isRegularMode ? '#fff' : '#1f2937',
                    cursor:'pointer',
                    fontWeight:600,
                  }}
                >{regularLabel}</button>
                <button
                  onClick={()=>setMatchMode('knockout')}
                  aria-pressed={!isRegularMode}
                  style={{
                    padding:'6px 12px',
                    borderRadius:8,
                    border:'1px solid #d1d5db',
                    background: !isRegularMode ? '#2563eb' : '#fff',
                    color: !isRegularMode ? '#fff' : '#1f2937',
                    cursor:'pointer',
                    fontWeight:600,
                  }}
                >{knockoutLabel}</button>
              </div>
            </div>
          </div>


          {isRegularMode ? (
        <>
        <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(0, 1fr))',
            gap:12,
            gridAutoFlow:'row dense',
            alignItems:'center'
          }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                启用对局
                <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
              </label>
              <button onClick={doResetAll} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
                清空
              </button>
            </div>
          </div>

          <label style={{ display:'flex', alignItems:'center', gap:8 }}>局数
            <input
              type="number"
              min={1}
              step={1}
              value={rounds}
              onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))}
              style={{ flex:'1 1 120px', minWidth:0 }}
            />
          </label>


          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                可抢地主
                <input type="checkbox" checked={bid} onChange={e=>setBid(e.target.checked)} />
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                农民配合
                <input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} />
              </label>
            </div>
          </div>
          <div style={{ gridColumn:'2 / 3' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>初始分
            <input
              type="number"
              step={10}
              value={startScore}
              onChange={e=>setStartScore(Number(e.target.value)||0)}
              style={{ flex:'1 1 120px', minWidth:0 }} />
            </label>
          </div>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                天梯  /  TrueSkill
                <input
                  ref={allFileRef}
                  type="file"
                  accept="application/json"
                  style={{ display:'none' }}
                  onChange={handleAllFileUploadHome}
                />
                <button
                  onClick={()=>allFileRef.current?.click()}
                  style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
                >上传</button>
              </label>
              <button
                onClick={()=>window.dispatchEvent(new Event('ddz-all-save'))}
                style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
              >存档</button>
            </div>
          </div>
          <label style={{ gridColumn:'2 / 3', display:'flex', alignItems:'center', gap:8 }}>4带2 规则
            <select
              value={four2}
              onChange={e=>setFour2(e.target.value as Four2Policy)}
              style={{ flex:'1 1 160px', minWidth:0 }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop:10, borderTop:'1px dashed #eee', paddingTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ border:'1px dashed #ccc', borderRadius:8, padding:10 }}>
                <div style={{ marginBottom:8 }}><SeatTitle i={i} /></div>

                <label style={{ display:'block', marginBottom:6 }}>
                  选择
                  <select
                    value={seats[i]}
                    onChange={e=>{
                      const v = e.target.value as BotChoice;
                      setSeats(arr => { const n=[...arr]; n[i] = v; return n; });
                      // 新增：切换提供商时，把当前输入框改成该提供商的推荐模型
                      setSeatModels(arr => { const n=[...arr]; n[i] = defaultModelFor(v); return n; });
                    }}
                    style={{ width:'100%' }}
                  >
                    <optgroup label={lang === 'en' ? 'Built-in' : '内置'}>
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                      <option value="built-in:advanced-hybrid">Advanced Hybrid</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'AI / External' : 'AI / 外置'}>
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'Human' : '人类选手'}>
                      <option value="human">{humanOptionLabel}</option>
                    </optgroup>
                  </select>
                </label>

                {seats[i].startsWith('ai:') && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    模型（可选）
                    <input
                      type="text"
                      value={seatModels[i]}
                      placeholder={defaultModelFor(seats[i])}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                      }}
                      style={{ width:'100%' }}
                    />
                    <div style={{ fontSize:12, color:'#777', marginTop:4 }}>
                      留空则使用推荐：{defaultModelFor(seats[i])}
                    </div>
                  </label>
                )}

                {seats[i] === 'ai:openai' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    OpenAI API Key
                    <input type="password" value={seatKeys[i]?.openai||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), openai:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:gemini' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Gemini API Key
                    <input type="password" value={seatKeys[i]?.gemini||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), gemini:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:grok' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    xAI (Grok) API Key
                    <input type="password" value={seatKeys[i]?.grok||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), grok:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:kimi' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Kimi API Key
                    <input type="password" value={seatKeys[i]?.kimi||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), kimi:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:qwen' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Qwen API Key
                    <input type="password" value={seatKeys[i]?.qwen||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), qwen:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:deepseek' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    DeepSeek API Key
                    <input type="password" value={seatKeys[i]?.deepseek||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), deepseek:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'http' && (
                  <>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Base / URL
                      <input type="text" value={seatKeys[i]?.httpBase||''}
                        onChange={e=>{
                          const v = e.target.value;
                          setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpBase:v }; return n; });
                        }}
                        style={{ width:'100%' }} />
                    </label>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Token（可选）
                      <input type="password" value={seatKeys[i]?.httpToken||''}
                        onChange={e=>{
                          const v = e.target.value;
                          setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpToken:v }; return n; });
                        }}
                        style={{ width:'100%' }} />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input
                      type="number" min={0} step={100}
                      value={ (seatDelayMs[i] ?? 0) }
                      onChange={e=>setSeatDelay(i, e.target.value)}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>

              ))}
            </div>
          </div>
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家思考超时（秒）</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    弃牌时间（秒）
                    <input
                      type="number" min={5} step={1}
                      value={ (turnTimeoutSecs[i] ?? 30) }
                      onChange={e=>{
                        const v = Math.max(5, Math.floor(Number(e.target.value)||0));
                        setTurnTimeoutSecs(arr=>{ const cp=[...(arr||[30,30,30])]; cp[i]=v; return cp; });
                      }}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>

        <div ref={ladderControlsHostRef} style={{ margin:'16px 0' }} />

        <div style={{ border:'1px solid #eee', borderRadius:12, padding:14 }}>
          {/* —— 天梯图 —— */}
          <LadderPanel />
          <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局</div>
          <LivePanel
            key={resetKey}
            instanceId={resetKey}
            rounds={rounds}
            startScore={startScore}
            seatDelayMs={seatDelayMs}
            enabled={enabled}
            bid={bid}
            four2={four2}
            seats={seats}
            seatModels={seatModels}
            seatKeys={seatKeys}
            farmerCoop={farmerCoop}
            onLog={setLiveLog}
            onFinished={handleRegularFinished}

            turnTimeoutSecs={turnTimeoutSecs}
            controlsPortal={ladderControlsHost}
          />
        </div>
        </>
      ) : (
        <KnockoutPanel />
      )}
        </div>
        {discordOpen && renderViaPortal(
          <div
            role="presentation"
            onClick={() => setDiscordOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.45)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              padding:'24px',
              zIndex:2000,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ddz-discord-title"
              onClick={e => e.stopPropagation()}
              data-i18n-ignore
              style={{
                background:'#fff',
                maxWidth:560,
                width:'100%',
                maxHeight:'80vh',
                overflowY:'auto',
                borderRadius:12,
                boxShadow:'0 20px 45px rgba(15,23,42,0.25)',
                padding:'24px 28px',
                lineHeight:1.65,
              }}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                <h2 id="ddz-discord-title" style={{ margin:0, fontSize:20, fontWeight:800, color:'#1f2937' }}>{discordContent.title}</h2>
                <button
                  type="button"
                  onClick={() => setDiscordOpen(false)}
                  aria-label={lang === 'en' ? I18N.en.DiscordClose : I18N.zh.DiscordClose}
                  style={{
                    border:'none',
                    background:'transparent',
                    color:'#6b7280',
                    fontSize:24,
                    lineHeight:1,
                    cursor:'pointer',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:18, color:'#374151', fontSize:14 }}>
                {discordContent.intro?.map((text, idx) => (
                  <p key={`discord-intro-${idx}`} style={{ margin:0 }}>{renderRichText(text)}</p>
                ))}
                <div
                  style={{
                    border:'1px solid #c7d2fe',
                    background:'#eef2ff',
                    borderRadius:12,
                    padding:'16px 18px',
                    display:'flex',
                    flexDirection:'column',
                    gap:8,
                  }}
                >
                  <strong style={{ fontSize:15, color:'#312e81' }}>{discordContent.serverName}</strong>
                  <p style={{ margin:0, color:'#4338ca' }}>{renderRichText(discordContent.inviteText)}</p>
                  {discordContent.inviteNote ? (
                    <p style={{ margin:0, color:'#4c1d95' }}>{renderRichText(discordContent.inviteNote)}</p>
                  ) : null}
                  <a
                    href={discordContent.inviteUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      alignSelf:'flex-start',
                      padding:'6px 14px',
                      borderRadius:999,
                      background:'#6366f1',
                      color:'#fff',
                      fontWeight:600,
                      textDecoration:'none',
                      boxShadow:'0 5px 12px rgba(79,70,229,0.35)',
                    }}
                  >
                    {lang === 'en' ? 'Open Discord' : '打开 Discord'}
                  </a>
                </div>
                {discordContent.sections.map(section => (
                  <section
                    key={`discord-section-${section.heading}`}
                    style={{
                      display:'flex',
                      flexDirection:'column',
                      gap:12,
                      border:'1px solid #e5e7eb',
                      borderRadius:12,
                      padding:'16px 18px',
                      background:'#f9fafb',
                    }}
                  >
                    <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#1f2937' }}>{section.heading}</h3>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {section.items.map(item => (
                        <div
                          key={`discord-item-${section.heading}-${item.id}`}
                          style={{ display:'flex', flexDirection:'column', gap:4 }}
                        >
                          <div style={{ fontWeight:700, color:'#1d4ed8' }}>
                            {item.link ? (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color:'#1d4ed8', textDecoration:'underline' }}
                              >
                                {item.name}
                              </a>
                            ) : (
                              item.name
                            )}
                          </div>
                          <div style={{ color:'#4b5563' }}>{renderRichText(item.description)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {discordContent.footer?.map((text, idx) => (
                  <p key={`discord-footer-${idx}`} style={{ margin:0, fontSize:13, color:'#6b7280' }}>
                    {renderRichText(text)}
                  </p>
                ))}
              </div>
            </div>
          </div>,
          disclaimerHostRef.current,
        )}
        {blogOpen && renderViaPortal(
          <div
            role="presentation"
            onClick={() => setBlogOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.45)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              padding:'24px',
              zIndex:2000,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ddz-blog-title"
              onClick={e => e.stopPropagation()}
              data-i18n-ignore
              style={{
                background:'#fff',
                maxWidth:640,
                width:'100%',
                maxHeight:'80vh',
                overflowY:'auto',
                borderRadius:12,
                boxShadow:'0 20px 45px rgba(15,23,42,0.25)',
                padding:'24px 28px',
                lineHeight:1.65,
              }}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                <h2 id="ddz-blog-title" style={{ margin:0, fontSize:20, fontWeight:800, color:'#1f2937' }}>{blogContent.title}</h2>
                <button
                  type="button"
                  onClick={() => setBlogOpen(false)}
                  aria-label={lang === 'en' ? I18N.en.BlogClose : I18N.zh.BlogClose}
                  style={{
                    border:'none',
                    background:'transparent',
                    color:'#6b7280',
                    fontSize:24,
                    lineHeight:1,
                    cursor:'pointer',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:18, color:'#374151', fontSize:14 }}>
                {blogContent.intro?.map((text, idx) => (
                  <p key={`blog-intro-${idx}`} style={{ margin:0 }}>{renderRichText(text)}</p>
                ))}
                {blogContent.posts.map(post => (
                  <article
                    key={post.id}
                    style={{
                      border:'1px solid #e5e7eb',
                      borderRadius:12,
                      padding:'16px 18px',
                      display:'flex',
                      flexDirection:'column',
                      gap:12,
                      background:'#f9fafb',
                    }}
                  >
                    <header style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'#111827' }}>{post.title}</h3>
                      <span style={{ fontSize:12, color:'#6b7280' }}>{post.date}</span>
                    </header>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {post.paragraphs.map((text, idx) => (
                        <p key={`blog-${post.id}-p-${idx}`} style={{ margin:0 }}>{renderRichText(text)}</p>
                      ))}
                    </div>
                    {post.tags && post.tags.length > 0 ? (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                        {post.tags.map(tag => (
                          <span
                            key={`blog-${post.id}-tag-${tag}`}
                            style={{
                              display:'inline-flex',
                              alignItems:'center',
                              padding:'2px 8px',
                              borderRadius:999,
                              background:'#fff',
                              border:'1px solid #fbbf24',
                              color:'#b45309',
                              fontSize:12,
                              fontWeight:600,
                            }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>,
          disclaimerHostRef.current,
        )}
        {developerJoinOpen && renderViaPortal(
          <div
            role="presentation"
            onClick={() => setDeveloperJoinOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.45)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              padding:'24px',
              zIndex:2000,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ddz-developer-join-title"
              onClick={e => e.stopPropagation()}
              style={{
                background:'#fff',
                maxWidth:520,
                width:'100%',
                maxHeight:'80vh',
                overflowY:'auto',
                borderRadius:12,
                boxShadow:'0 20px 45px rgba(15,23,42,0.25)',
                padding:'24px 28px',
                lineHeight:1.6,
              }}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                <h2 id="ddz-developer-join-title" style={{ margin:0, fontSize:20, fontWeight:800, color:'#1f2937' }}>{developerJoinContent.title}</h2>
                <button
                  type="button"
                  onClick={() => setDeveloperJoinOpen(false)}
                  aria-label={lang === 'en' ? I18N.en.DeveloperJoinClose : I18N.zh.DeveloperJoinClose}
                  style={{
                    border:'none',
                    background:'transparent',
                    color:'#6b7280',
                    fontSize:24,
                    lineHeight:1,
                    cursor:'pointer',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:16, color:'#374151' }}>
                {developerJoinContent.blocks.map((block, blockIndex) => {
                  if (block.kind === 'paragraph') {
                    return (
                      <p key={`dev-join-paragraph-${blockIndex}`} style={{ margin:0, fontSize:14, lineHeight:1.7 }}>
                        {renderRichText(block.text)}
                      </p>
                    );
                  }
                  return (
                    <div key={`dev-join-list-${blockIndex}`} style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#1f2937' }}>{block.title}</h3>
                      <ul style={{ margin:0, paddingLeft:20, fontSize:14, display:'flex', flexDirection:'column', gap:6 }}>
                        {block.items.map((item, itemIndex) => {
                          if (typeof item === 'string') {
                            return (
                              <li key={`dev-join-item-${blockIndex}-${itemIndex}`} style={{ margin:0 }}>
                                {renderRichText(item)}
                              </li>
                            );
                          }
                          return (
                            <li key={`dev-join-item-${blockIndex}-${itemIndex}`} style={{ margin:0 }}>
                              {item.prefix ? <span>{item.prefix}</span> : null}
                              {item.prefix ? ' ' : null}
                              {renderRichText(item.text)}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          disclaimerHostRef.current,
        )}
        {disclaimerOpen && renderViaPortal(
          <div
            role="presentation"
            onClick={() => setDisclaimerOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.45)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              padding:'24px',
              zIndex:2000,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ddz-disclaimer-title"
              onClick={e => e.stopPropagation()}
              style={{
                background:'#fff',
                maxWidth:720,
                width:'100%',
                maxHeight:'85vh',
                overflowY:'auto',
                borderRadius:12,
                boxShadow:'0 20px 45px rgba(15,23,42,0.25)',
                padding:'24px 28px',
                lineHeight:1.6,
              }}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                <h2 id="ddz-disclaimer-title" style={{ margin:0, fontSize:20, fontWeight:800, color:'#111827' }}>{disclaimerContent.title}</h2>
                <button
                  type="button"
                  onClick={() => setDisclaimerOpen(false)}
                  aria-label={lang === 'en' ? I18N.en.DisclaimerClose : I18N.zh.DisclaimerClose}
                  style={{
                    border:'none',
                    background:'transparent',
                    color:'#6b7280',
                    fontSize:24,
                    lineHeight:1,
                    cursor:'pointer',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:18 }}>
                {disclaimerContent.sections.map(section => (
                  <section key={section.title}>
                    <h3 style={{ margin:'0 0 8px', fontSize:16, fontWeight:700, color:'#1f2937' }}>{section.title}</h3>
                    {section.paragraphs.map((text, idx) => (
                      <p key={idx} style={{ margin:'0 0 10px', color:'#374151', fontSize:14 }}>{text}</p>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </div>,
          disclaimerHostRef.current,
        )}
      </SeatInfoContext.Provider>
    </LangContext.Provider>
  </>);
}

(Home as PageSeoMeta).seoTitle = 'Fight the Landlord · AI Battle Platform';
(Home as PageSeoMeta).seoDescription =
  'AI Battle Platform（ai-gaming.online）是一个面向斗地主竞技项目的开源 AI 对战平台，鼓励使用提示词驱动完成算法研发、对战与评测。';
(Home as PageSeoMeta).seoKeywords = [
  'AI Battle Platform',
  'Fight the Landlord',
  '斗地主 AI',
  'Prompt Engineering',
  'AI 对战平台',
];

export default Home;

/* ================ 实时曲线：每手牌得分（按地主淡色分局） ================= */
function ScoreTimeline(
  { series, bands = [], landlords = [], labels = ['甲','乙','丙'], height = 220, breaks = [] }:
  { series:(number|null)[][]; bands?:number[]; landlords?:number[]; labels?:string[]; height?:number; breaks?:number[] }
) {
  const ref = useRef<HTMLDivElement|null>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<null | { si:number; idx:number; x:number; y:number; v:number }>(null);

  useEffect(()=>{
    const el = ref.current; if(!el) return;
    const ro = new ResizeObserver(()=> setW(el.clientWidth || 600));
    ro.observe(el);
    return ()=> ro.disconnect();
  }, []);

  const data = series || [[],[],[]];
  const n = Math.max(data[0]?.length||0, data[1]?.length||0, data[2]?.length||0);
  const values:number[] = [];
  for (const arr of data) for (const v of (arr||[])) if (typeof v==='number') values.push(v);
  const vmin = values.length ? Math.min(...values) : -5;
  const vmax = values.length ? Math.max(...values) : 5;
  const pad = (vmax - vmin) * 0.15 + 1e-6;
  const y0 = vmin - pad, y1 = vmax + pad;

  const width = Math.max(320, w);
  const heightPx = height;
  const left = 36, right = 10, top = 10, bottom = 22;
  const iw = Math.max(10, width - left - right);
  const ih = Math.max(10, heightPx - top - bottom);

  const x = (i:number)=> (n<=1 ? 0 : (i/(n-1))*iw);
  const y = (v:number)=> ih - ( (v - y0) / (y1 - y0) ) * ih;

  const colorLine = ['#ef4444', '#3b82f6', '#10b981'];
  const colorBand = ['rgba(239,68,68,0.16)','rgba(59,130,246,0.16)','rgba(16,185,129,0.20)'];
  const colorBandFallback = ['#fef2f2', '#eff6ff', '#f0fdf4'];
  const colors = colorLine;

  const cuts = Array.isArray(bands) && bands.length ? [...bands] : [0];
  cuts.sort((a,b)=>a-b);
  if (cuts[0] !== 0) cuts.unshift(0);
  if (cuts[cuts.length-1] !== n) cuts.push(n);
  const cutSet = new Set(cuts);

  const explicitBreaks = Array.isArray(breaks)
    ? breaks
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
        .map((v) => Math.max(0, Math.floor(v)))
        .sort((a, b) => a - b)
    : [];
  const breakSet = new Set(explicitBreaks);
  {
    let lastSeatWithValue = -1;
    for (let idx = 0; idx < n; idx++) {
      let seat = -1;
      for (let si = 0; si < data.length; si++) {
        const val = data[si]?.[idx];
        if (typeof val === 'number' && Number.isFinite(val)) { seat = si; break; }
      }
      if (seat < 0) continue;
      if (idx !== 0 && seat === lastSeatWithValue && !cutSet.has(idx) && !breakSet.has(idx)) {
        breakSet.add(idx);
      }
      lastSeatWithValue = seat;
    }
  }

  const landlordsArr = Array.isArray(landlords) ? landlords.slice(0) : [];
  while (landlordsArr.length < Math.max(0, cuts.length-1)) landlordsArr.push(-1);

  // —— 底色兜底：把未知地主段回填为最近一次已知的地主（前向填充 + 首段回填） ——
  const segCount = Math.max(0, cuts.length - 1);
  const landlordsFilled = landlordsArr.slice(0, segCount);
  while (landlordsFilled.length < segCount) landlordsFilled.push(-1);
  for (let j=0; j<landlordsFilled.length; j++) {
    const v = landlordsFilled[j];
    if (!(v===0 || v===1 || v===2)) landlordsFilled[j] = j>0 ? landlordsFilled[j-1] : landlordsFilled[j];
  }
  if (landlordsFilled.length && !(landlordsFilled[0]===0 || landlordsFilled[0]===1 || landlordsFilled[0]===2)) {
    const k = landlordsFilled.findIndex(v => v===0 || v===1 || v===2);
    if (k >= 0) { for (let j=0; j<k; j++) landlordsFilled[j] = landlordsFilled[k]; }
  }

  const makePath = (arr:(number|null)[])=>{
    let d=''; let open=false;
    for (let i=0;i<n;i++){
      if ((cutSet.has(i) || breakSet.has(i)) && i!==0) { open = false; }
      const v = arr[i];
      if (typeof v !== 'number') { open=false; continue; }
      const px = x(i), py = y(v);
      d += (open? ` L ${px} ${py}` : `M ${px} ${py}`);
      open = true;
    }
    return d;
  };

  // x 轴刻度（最多 12 个）
  const ticks = []; const maxTicks = 12;
  for (let i=0;i<n;i++){
    const step = Math.ceil(n / maxTicks);
    if (i % step === 0) ticks.push(i);
  }
  // y 轴刻度（5 条）
  const yTicks = []; for (let k=0;k<=4;k++){ yTicks.push(y0 + (k/4)*(y1-y0)); }

  // —— 悬浮处理 —— //
  const seatName = (i:number)=> labels?.[i] ?? ['甲','乙','丙'][i];
  const showTip = (si:number, idx:number, v:number) => {
    setHover({ si, idx, v, x: x(idx), y: y(v) });
  };
  const hideTip = () => setHover(null);

  // 估算文本宽度（无需测量 API）
  const tipText = hover ? `${seatName(hover.si)} 第${hover.idx+1}手：${hover.v.toFixed(2)}` : '';
  const tipW = 12 + tipText.length * 7;  // 近似
  const tipH = 20;
  const tipX = hover ? Math.min(Math.max(0, hover.x + 10), Math.max(0, iw - tipW)) : 0;
  const tipY = hover ? Math.max(0, hover.y - (tipH + 10)) : 0;

  return (
    <div ref={ref} style={{ width:'100%' }}>
      <svg width={width} height={heightPx} style={{ display:'block', width:'100%' }}>
        <g transform={`translate(${left},${top})`} onMouseLeave={hideTip}>
          {/* 按地主上色的局间底色 */}
          {cuts.slice(0, Math.max(0, cuts.length-1)).map((st, i)=>{
            const ed = cuts[i+1];
            if (ed <= st) return null;
            const x0 = x(st);
            const x1 = x(Math.max(st, ed-1));
            const w  = Math.max(0.5, x1 - x0);
            const lord = landlordsFilled[i] ?? -1;
            const fill = (lord===0||lord===1||lord===2)
              ? colorBand[lord]
              : colorBandFallback[i % colorBandFallback.length];
            return <rect key={'band'+i} x={x0} y={0} width={w} height={ih} fill={fill} />;
          })}

          {/* 网格 + 轴 */}
          <line x1={0} y1={ih} x2={iw} y2={ih} stroke="#e5e7eb" />
          <line x1={0} y1={0} x2={0} y2={ih} stroke="#e5e7eb" />
          {yTicks.map((v,i)=>(
            <g key={i} transform={`translate(0,${y(v)})`}>
              <line x1={0} y1={0} x2={iw} y2={0} stroke="#f3f4f6" />
              <text x={-6} y={4} fontSize={10} fill="#6b7280" textAnchor="end">{v.toFixed(1)}</text>
            </g>
          ))}
          {ticks.map((i,idx)=>(
            <g key={idx} transform={`translate(${x(i)},0)`}>
              <line x1={0} y1={0} x2={0} y2={ih} stroke="#f8fafc" />
              <text x={0} y={ih+14} fontSize={10} fill="#6b7280" textAnchor="middle">{i+1}</text>
            </g>
          ))}

          {/* 三条曲线 + 数据点 */}
          {data.map((arr, si)=>(
            <g key={'g'+si}>
              <path d={makePath(arr)} fill="none" stroke={colors[si]} strokeWidth={2} />
              {arr.map((v,i)=> (typeof v==='number') && (
                <circle
                  key={'c'+si+'-'+i}
                  cx={x(i)} cy={y(v)} r={2.5} fill={colors[si]}
                  style={{ cursor:'crosshair' }}
                  onMouseEnter={()=>showTip(si, i, v)}
                  onMouseMove={()=>showTip(si, i, v)}
                  onMouseLeave={hideTip}
                >
                  {/* 备用：系统 tooltip（可保留） */}
                  <title>{`${seatName(si)} 第${i+1}手：${v.toFixed(2)}`}</title>
                </circle>
              ))}
            </g>
          ))}

          {/* 悬浮提示框 */}
          {hover && (
            <g transform={`translate(${tipX},${tipY})`} pointerEvents="none">
              <rect x={0} y={0} width={tipW} height={tipH} rx={6} ry={6} fill="#111111" opacity={0.9} />
              <text x={8} y={13} fontSize={11} fill="#ffffff">{tipText}</text>
            </g>
          )}
        </g>
      </svg>

      {/* 图例 */}
      <div style={{ display:'flex', gap:12, marginTop:6, fontSize:12, color:'#374151' }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:10, height:10, borderRadius:5, background:colors[i], display:'inline-block' }} />
            <span>{labels?.[i] ?? ['甲','乙','丙'][i]}</span>
          </div>
        ))}
      <div style={{ marginLeft:'auto', color:'#6b7280' }}>横轴：第几手牌 ｜ 纵轴：score</div>
      </div>
    </div>
  );
}
