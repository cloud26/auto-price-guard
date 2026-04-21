// Variation A — "Calm Utility"
// A refined version of the current UI: same structural DNA (header →
// status card → settings → log → footer) but quieter, more breathing
// room, hero savings number elevated, clearer typographic hierarchy.

function VariationA({ theme, accent, dark, running, onToggleRun }) {
  const t = theme;
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((x) => x + 1), 900);
    return () => clearInterval(id);
  }, [running]);

  const logLines = [
    { t: '12:01:52', kind: 'muted',  text: '开始检查订单 · 共 3 笔订单待扫描' },
    { t: '12:01:55', kind: 'muted',  text: '打开「我的订单」页面' },
    { t: '12:01:57', kind: 'muted',  text: '点击「一键价保」按钮' },
    { t: '12:02:01', kind: 'muted',  text: '提交价保申请 × 2' },
    { t: '12:02:05', kind: 'accent', text: '优惠券价保命中：¥25.00' },
    { t: '12:02:05', kind: 'success',text: '价保成功 · 1 件商品 · 退款 ¥25.00' },
    { t: '12:02:05', kind: 'muted',  text: '本次执行完成 · 用时 13s' },
  ];

  return (
    <div style={{
      width: 820, height: 980, background: t.bg, color: t.text,
      fontFamily: SYSTEM_FONT, display: 'flex', flexDirection: 'column',
      borderRadius: '10px 10px 0 0', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{
        height: 44, background: t.chromeBg, borderBottom: `1px solid ${t.line}`,
        display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0,
      }}>
        <TrafficLights/>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500, color: t.chromeText, marginRight: 56 }}>
          价保助手
        </div>
      </div>

      {/* Top: greeting + login status */}
      <div style={{ padding: '24px 32px 18px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4 }}>下午好,Cloud</div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>价保助手</div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 999,
          background: t.surface2, border: `1px solid ${t.line}`,
          fontSize: 12.5, color: t.textMuted,
        }}>
          <StatusDot color={t.success} pulse/>
          <span>已登录京东</span>
          <span style={{ color: t.textSubtle, margin: '0 2px' }}>·</span>
          <span style={{ color: t.textSubtle, cursor: 'pointer' }}>退出</span>
        </div>
      </div>

      {/* Hero savings */}
      <div style={{ padding: '0 32px' }}>
        <div style={{
          position: 'relative',
          background: t.surface, borderRadius: 16, padding: '28px 28px 24px',
          border: `1px solid ${t.line}`,
          overflow: 'hidden',
        }}>
          {/* soft accent wash */}
          <div style={{
            position: 'absolute', top: -60, right: -60, width: 240, height: 240,
            background: `radial-gradient(circle, ${t.accentSoft} 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}/>
          <div style={{ fontSize: 12, color: t.textMuted, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 10, position: 'relative' }}>
            累计省钱
          </div>
          <div style={{
            fontFamily: DISPLAY_FONT, fontSize: 64, fontWeight: 300,
            letterSpacing: -2, lineHeight: 1, position: 'relative',
            color: t.accent, display: 'flex', alignItems: 'baseline', gap: 4,
          }} className="jd-num">
            <span style={{ fontSize: 36, fontWeight: 400, opacity: .8 }}>¥</span>
            <span>1,284</span>
            <span style={{ fontSize: 32, fontWeight: 300, opacity: .55 }}>.50</span>
          </div>
          <div style={{
            marginTop: 14, display: 'flex', gap: 28, fontSize: 13, color: t.textMuted, position: 'relative',
          }}>
            <div><span style={{ color: t.text, fontWeight: 500 }} className="jd-num">37</span> 件商品成功退款</div>
            <div><span style={{ color: t.text, fontWeight: 500 }} className="jd-num">68</span> 次自动执行</div>
            <div>自 2025.08.12 起</div>
          </div>
        </div>
      </div>

      {/* Run state */}
      <div style={{ padding: '16px 32px 0' }}>
        <div style={{
          background: t.surface, borderRadius: 16, border: `1px solid ${t.line}`,
          padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <div style={{
              fontSize: 12, color: t.textMuted, letterSpacing: 0.3, textTransform: 'uppercase', flex: 1,
            }}>运行状态</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: running ? t.accent : t.textMuted,
            }}>
              <StatusDot color={running ? t.accent : t.textSubtle} pulse={running}/>
              {running ? '运行中…' : '未启动'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
            <StatCell t={t} label="上次运行" value="04-18 12:02" meta="13 秒前"/>
            <StatCell t={t} label="本次结果" value="成功 ¥25.00" valueColor={t.success} meta="优惠券价保"/>
            <StatCell t={t} label="下次运行" value="46 分钟后" meta="13:02"/>
          </div>

          {/* progress strip when running */}
          {running && (
            <div style={{ marginTop: 16, height: 3, background: t.surfaceInset, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0, width: '33%',
                background: `linear-gradient(90deg, transparent, ${t.accent}, transparent)`,
                animation: 'jd-sweep 1.8s linear infinite',
              }}/>
            </div>
          )}
        </div>
      </div>

      {/* Settings + Run */}
      <div style={{ padding: '16px 32px 0', display: 'flex', gap: 12 }}>
        <div style={{
          flex: 1, background: t.surface, borderRadius: 14, border: `1px solid ${t.line}`,
          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={t.textMuted} strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l2.5 1.5"/>
          </svg>
          <div style={{ fontSize: 13.5, color: t.text, flex: 1 }}>执行间隔</div>
          <select style={{
            background: 'transparent', border: 'none', color: t.text,
            fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
            textAlign: 'right',
          }} defaultValue="2">
            <option value="0.5">每 30 分钟</option>
            <option value="1">每 1 小时</option>
            <option value="2">每 2 小时</option>
            <option value="4">每 4 小时</option>
            <option value="6">每 6 小时</option>
            <option value="12">每 12 小时</option>
            <option value="24">每 24 小时</option>
          </select>
        </div>
        <button onClick={onToggleRun} style={{
          padding: '0 24px', height: 46,
          background: running ? t.surface : t.accent,
          color: running ? t.text : '#fff',
          border: running ? `1px solid ${t.lineStrong}` : 'none',
          borderRadius: 14, fontSize: 13.5, fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'inherit',
        }}>
          {running ? (
            <><span style={{ width: 8, height: 8, borderRadius: 2, background: t.text }}/> 停止</>
          ) : (
            <><PlayIcon/> 立即执行</>
          )}
        </button>
      </div>

      {/* Log */}
      <div style={{ padding: '16px 32px 20px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10,
        }}>
          <div style={{ fontSize: 12, color: t.textMuted, letterSpacing: 0.3, textTransform: 'uppercase', flex: 1 }}>运行日志</div>
          <div style={{ fontSize: 12, color: t.textSubtle }}>最近 50 条</div>
        </div>
        <div style={{
          flex: 1, background: t.logBg, borderRadius: 12,
          padding: '14px 16px', fontFamily: MONO_FONT, fontSize: 12, lineHeight: 1.7,
          color: t.logText, overflow: 'hidden',
        }}>
          {logLines.map((l, i) => (
            <div key={i} style={{
              color: l.kind === 'success' ? t.logSuccess : l.kind === 'accent' ? t.logAccent : t.logMuted,
            }}>
              <span style={{ color: 'rgba(181,181,186,.35)' }}>[04-18 {l.t}] </span>
              {l.text}
            </div>
          ))}
          <div style={{ color: t.logMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: .5 }}>▸</span>
            <span style={{ opacity: .6, animation: 'jd-breathe 1.4s ease-in-out infinite' }}>_</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 32px 12px', fontSize: 11, color: t.textSubtle, textAlign: 'center',
      }}>
        关闭窗口后将在菜单栏继续运行 · v1.1.0
      </div>
    </div>
  );
}

function StatCell({ t, label, value, valueColor, meta }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>{label}</div>
      <div className="jd-num" style={{ fontSize: 16, fontWeight: 500, color: valueColor || t.text, letterSpacing: -0.2 }}>{value}</div>
      {meta && <div style={{ fontSize: 11.5, color: t.textSubtle, marginTop: 2 }}>{meta}</div>}
    </div>
  );
}

function PlayIcon() {
  return <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M1 1.2v9.6c0 .7.77 1.12 1.36.74l7.5-4.8a.88.88 0 000-1.48L2.36.46A.88.88 0 001 1.2z"/></svg>;
}

Object.assign(window, { VariationA });
