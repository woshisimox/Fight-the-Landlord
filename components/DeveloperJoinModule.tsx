import { useState } from 'react';

type Lang = 'zh' | 'en';

type BulletItem = {
  text: string;
  href?: string;
  label?: string;
};

type Section = {
  title: string;
  paragraphs: string[];
  bullets?: BulletItem[];
};

type DeveloperJoinContent = {
  heading: string;
  tagline: string;
  buttonLabel: string;
  modalTitle: string;
  closeLabel: string;
  sections: Section[];
};

const CONTENT: Record<Lang, DeveloperJoinContent> = {
  zh: {
    heading: '开发者加入',
    tagline:
      '欢迎研究者、工程师与设计师参与共建 AI 斗地主平台。我们期待你的专业力量，携手打造可靠、透明、可持续的竞技环境。',
    buttonLabel: '查看加入说明',
    modalTitle: '开发者加入说明',
    closeLabel: '关闭',
    sections: [
      {
        title: '项目定位',
        paragraphs: [
          'Fight the Landlord 是一个开源、非商业化的 AI 对战平台，代码托管于 GitHub，旨在推动斗地主领域的智能体对战与评测研究。',
          '我们坚持合规、安全、开放、可持续的原则，鼓励负责任的学术探索与工程实践。',
        ],
      },
      {
        title: '加入步骤',
        paragraphs: ['请按照以下流程加入开发：'],
        bullets: [
          {
            text: '访问项目仓库：',
            href: 'https://github.com/woshisimox/Fight-the-Landlord',
            label: 'woshisimox/Fight-the-Landlord',
          },
          { text: '通过 Issue 认领任务，或在讨论区提出新想法。请附上动机、预期方案及潜在影响。' },
          { text: 'Fork 仓库并创建分支，保持提交记录清晰，遵循既有代码风格与许可要求。' },
          { text: '提交 Pull Request，并在描述中列出变更要点、测试情况及潜在风险。' },
        ],
      },
      {
        title: '协作守则',
        paragraphs: [
          '遵守社区行为准则，尊重他人劳动成果。',
          '确保代码与数据来源合法合规，不嵌入任何未经授权的第三方服务或闭源模型权属风险。',
          '涉及模型 API Key 或敏感配置的修改，请使用环境变量或本地配置文件，不得提交到仓库。',
        ],
      },
      {
        title: '支持与反馈',
        paragraphs: [
          '如需技术交流或资源协调，可在 GitHub Issues 或 Discussions 中留言，核心维护者将定期回复。',
          '我们鼓励撰写详尽的技术文档与实验报告，帮助社区沉淀知识。',
        ],
      },
    ],
  },
  en: {
    heading: 'Join as a Developer',
    tagline:
      'Researchers, engineers, and designers are welcome to co-build the Fight the Landlord AI platform. Bring your expertise and help us deliver a trustworthy, transparent, and sustainable competitive arena.',
    buttonLabel: 'Read onboarding guide',
    modalTitle: 'Developer Onboarding Guide',
    closeLabel: 'Close',
    sections: [
      {
        title: 'Project Overview',
        paragraphs: [
          'Fight the Landlord is an open-source, non-commercial AI battle platform hosted on GitHub. It advances research on Dou Dizhu agents and benchmarking.',
          'We uphold compliance, safety, openness, and sustainability, and we encourage responsible academic and engineering contributions.',
        ],
      },
      {
        title: 'How to Get Started',
        paragraphs: ['Follow the workflow below to join the project:'],
        bullets: [
          {
            text: 'Visit the repository:',
            href: 'https://github.com/woshisimox/Fight-the-Landlord',
            label: 'woshisimox/Fight-the-Landlord on GitHub',
          },
          {
            text: 'Claim an issue or start a discussion to propose new ideas. Share the motivation, planned approach, and expected impact.',
          },
          {
            text: 'Fork the repo, create a feature branch, and keep commits focused while respecting the current coding style and license terms.',
          },
          {
            text: 'Open a pull request summarizing your changes, verification steps, and any known limitations or risks.',
          },
        ],
      },
      {
        title: 'Collaboration Guidelines',
        paragraphs: [
          'Follow the community code of conduct and acknowledge prior work.',
          'Ensure that all code and data sources are legally compliant. Do not embed unapproved third-party services or models with unclear licenses.',
          'Handle model API keys or secrets via environment variables or local config files—never commit them to the repository.',
        ],
      },
      {
        title: 'Support & Feedback',
        paragraphs: [
          'Use GitHub Issues or Discussions for technical questions or coordination. Core maintainers monitor feedback regularly.',
          'Document your experiments and technical insights to help the community build shared knowledge.',
        ],
      },
    ],
  },
};

type Props = {
  lang: Lang;
};

export default function DeveloperJoinModule({ lang }: Props) {
  const [open, setOpen] = useState(false);
  const content = CONTENT[lang] ?? CONTENT.zh;

  return (
    <>
      <section
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 16,
          background: '#f9fafb',
          boxShadow: '0 6px 18px rgba(15, 23, 42, 0.06)',
        }}
        data-i18n-ignore
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#111827' }}>{content.heading}</h2>
            <p style={{ margin: 0, color: '#374151', fontSize: 14, lineHeight: 1.6 }}>{content.tagline}</p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: '1px solid #2563eb',
                background: '#eff6ff',
                color: '#1d4ed8',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{content.buttonLabel}</span>
              <span aria-hidden="true" style={{ fontSize: 16 }}>↗</span>
            </button>
          </div>
        </div>
      </section>

      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 2100,
          }}
          data-i18n-ignore
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="developer-onboarding-title"
            onClick={event => event.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 14,
              maxWidth: 680,
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '24px 28px',
              boxShadow: '0 25px 60px rgba(15, 23, 42, 0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <h3
                id="developer-onboarding-title"
                style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111827' }}
              >
                {content.modalTitle}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={content.closeLabel}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#6b7280',
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {content.sections.map(section => (
                <section key={section.title}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{section.title}</h4>
                  {section.paragraphs.map((paragraph, idx) => (
                    <p key={idx} style={{ margin: '0 0 10px', color: '#374151', fontSize: 14, lineHeight: 1.7 }}>
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul style={{ margin: '0 0 10px 18px', padding: 0, color: '#374151', fontSize: 14, lineHeight: 1.7 }}>
                      {section.bullets.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 6 }}>
                          {item.href ? (
                            <>
                              {item.text}
                              <a
                                href={item.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: '#1d4ed8',
                                  textDecoration: 'underline',
                                  marginLeft: 4,
                                }}
                              >
                                {item.label ?? item.href}
                              </a>
                            </>
                          ) : (
                            item.text
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
