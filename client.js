/**
 * dsh-novel-archive — client half.
 *
 * A small chip in the composer dock ("小说续接") opens a dialog that can
 *   1. paste a share link,
 *   2. attach the user's own 人设 / 补充文件,
 *   3. run the extraction,
 *   4. and continue the role-play with one click: the host builds the
 *      07-style prompt, we drop it into the composer and submit.
 *
 * Host side lives in `lib/api.js` (`/novel-archive/api/*`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-novel-archive',
  factory(require) {
    const React = require('react')
    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = null
    }
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/novel-archive/api'
    const STORE_DIR = 'novel-archive.dir'

    async function api(route, options) {
      const init = options ?? {}
      const response = await fetch(API + '/' + route, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
      })
      const text = await response.text()
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error(`接口返回异常（${response.status}）：${text.slice(0, 160)}`)
      }
      if (payload?.ok === true) return payload.value
      throw new Error(payload?.error?.message ?? `请求失败（${response.status}）`)
    }

    function readAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(`读不了 ${file.name}`))
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '')
          const at = dataUrl.indexOf(',')
          resolve(at === -1 ? '' : dataUrl.slice(at + 1))
        }
        reader.readAsDataURL(file)
      })
    }

    const COLORS = {
      border: 'rgba(127,127,127,.32)',
      soft: 'rgba(127,127,127,.14)',
      faint: 'rgba(127,127,127,.08)',
      muted: 'rgba(127,127,127,.95)',
      accent: '#0a7aff',
    }

    const styles = {
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: '24px',
        padding: '0 9px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '999px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '11.5px',
        lineHeight: 1,
        cursor: 'pointer',
        opacity: 0.82,
        whiteSpace: 'nowrap',
      },
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        background: 'rgba(0,0,0,.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      },
      card: {
        width: 'min(640px, 100%)',
        maxHeight: '82vh',
        overflow: 'auto',
        background: 'Canvas',
        color: 'CanvasText',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '14px',
        boxShadow: '0 24px 64px rgba(0,0,0,.28)',
        padding: '18px 20px 16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: '13px',
        lineHeight: 1.55,
      },
      head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' },
      title: { fontSize: '15px', fontWeight: 600 },
      hint: { color: COLORS.muted, fontSize: '12px', marginBottom: '12px' },
      label: { fontSize: '12px', color: COLORS.muted, margin: '10px 0 4px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center' },
      input: {
        flex: 1,
        minWidth: 0,
        height: '32px',
        padding: '0 10px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        outline: 'none',
      },
      button: {
        height: '32px',
        padding: '0 12px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        background: COLORS.faint,
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      primary: {
        height: '34px',
        padding: '0 14px',
        border: '1px solid transparent',
        borderRadius: '8px',
        background: COLORS.accent,
        color: '#fff',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      ghost: {
        height: '26px',
        padding: '0 8px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: COLORS.muted,
        font: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
      },
      file: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        margin: '4px 6px 0 0',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '999px',
        background: COLORS.faint,
        fontSize: '11.5px',
      },
      state: {
        marginTop: '12px',
        padding: '10px 12px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '10px',
        background: COLORS.faint,
        fontSize: '12px',
        display: 'grid',
        gap: '2px',
      },
      quote: { color: COLORS.muted, fontSize: '12px', marginTop: '2px' },
      message: { marginTop: '10px', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' },
      divider: { height: '1px', background: COLORS.soft, margin: '14px 0 10px' },
      footer: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', flexWrap: 'wrap' },
      badge: { fontSize: '11px', color: COLORS.muted, border: `1px solid ${COLORS.border}`, borderRadius: '999px', padding: '0 7px' },
      pickerItem: {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '5px 8px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      textarea: {
        width: '100%',
        minHeight: '150px',
        boxSizing: 'border-box',
        padding: '8px 10px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '8px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        resize: 'vertical',
      },
      pre: {
        margin: '8px 0 0',
        padding: '10px',
        maxHeight: '180px',
        overflow: 'auto',
        background: 'rgba(127,127,127,.10)',
        borderRadius: '8px',
        fontSize: '11.5px',
        whiteSpace: 'pre-wrap',
      },
    }

    function StateBlock({ state }) {
      if (!state) return null
      if (!state.exists) {
        return h('div', { style: styles.state },
          h('div', null, '还没整理过'),
          h('div', { style: styles.quote }, state.reason ?? ''))
      }
      const novel = state.novel
      return h('div', { style: styles.state },
        h('div', null,
          `${state.rounds} 轮 · 第 ${state.lastRound} 轮结束`,
          ` · 分章 ${state.beats}/${state.chunks}`,
          state.hasPack ? ' · 续接包已生成' : ''),
        novel
          ? h('div', { style: styles.quote },
              `${novel.title || '未命名'}｜${novel.hero} / ${novel.girl}`,
              novel.affection ? `｜好感度 ${novel.affection}` : '',
              novel.day || novel.place ? `｜${[novel.day, novel.place].filter(Boolean).join(' · ')}` : '')
          : h('div', { style: styles.quote }, 'novel.json 还没填：一键续接需要它（人物、当前场景、写法）'),
        !novel && state.exists
          ? h('div', { style: styles.quote }, '让 agent 按 PLAN.md 填好 novel.json，回来就能一键接。')
          : null,
        novel?.lastAiQuote
          ? h('div', { style: styles.quote }, `他上一句：「${novel.lastAiQuote}」`)
          : null)
    }

    function Dialog({ state, setState, dir, setDir, url, setUrl, settings, setSettings, extras, setExtras, onClose, inputActions }) {
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState(null)
      const [preview, setPreview] = useState('')
      const [config, setConfig] = useState(null)
      const settingInput = useRef(null)
      const extraInput = useRef(null)
      const [memory, setMemory] = useState(null)
      const [kb, setKb] = useState(null)
      const [card, setCard] = useState(null)
      const [picker, setPicker] = useState(null)

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const value = await api('config')
            if (!alive) return
            setConfig(value)
            if (!dir) setDir(localStorage.getItem(STORE_DIR) || value.defaultOut)
            else refresh()
          } catch (error) {
            if (alive) setMessage({ kind: 'error', text: String(error.message ?? error) })
          }
        })()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      async function refresh(nextDir) {
        const target = nextDir ?? dir
        if (!target) return
        try {
          const value = await api('state?dir=' + encodeURIComponent(target))
          setState(value)
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        }
        loadMemory(target)
        loadKb(target)
      }

      async function loadMemory(target) {
        const wanted = target ?? dir
        if (!wanted) return
        try {
          setMemory(await api('memory?dir=' + encodeURIComponent(wanted)))
        } catch {
          setMemory(null)
        }
      }

      async function loadKb(target) {
        const wanted = target ?? dir
        if (!wanted) return
        try {
          setKb(await api('kb?dir=' + encodeURIComponent(wanted)))
        } catch {
          setKb(null)
        }
      }

      async function runKb(action) {
        const labels = { init: '建知识库…', sync: '同步知识库…', index: '重建知识库索引…' }
        setBusy(labels[action] ?? '处理中…')
        setMessage(null)
        try {
          const value = await api('kb', { method: 'POST', body: { dir, action } })
          if (action === 'init') setMessage({ kind: 'info', text: `知识库已建，新增 ${value.created.length} 个文件` })
          if (action === 'sync') setMessage({ kind: 'info', text: `已同步 ${value.written.length} 个文件，事件簿新增 ${value.events} 条` })
          if (action === 'index') setMessage({ kind: 'info', text: '知识库索引已重建' })
          loadKb(dir)
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function openPicker(start) {
        setPicker({ path: start ?? '', dirs: [], parent: null, loading: true })
        await loadPicker(start ?? '')
      }

      async function loadPicker(path) {
        try {
          const value = await api('browse' + (path ? '?path=' + encodeURIComponent(path) : ''))
          setPicker({ path: value.path, parent: value.parent, dirs: value.dirs, loading: false })
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
          setPicker(null)
        }
      }

      async function runDigest() {
        if (!memory) return
        const from = Number(memory.to) + 1
        const to = Number(memory.totalRound)
        if (!(to >= from)) {
          setMessage({ kind: 'info', text: '记忆卡已经覆盖到最后一轮了' })
          return
        }
        setBusy('生成记忆卡底稿…')
        setMessage(null)
        try {
          const value = await api('memory', { method: 'POST', body: { dir, action: 'digest', from, to } })
          setCard({ from, to, text: value.text })
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function runSaveCard() {
        if (!card) return
        setBusy('存记忆卡…')
        try {
          const value = await api('memory', { method: 'POST', body: { dir, action: 'save', from: card.from, to: card.to, text: card.text } })
          setCard(null)
          setMessage({ kind: 'info', text: `已存 ${value.name}，索引已更新` })
          loadMemory(dir)
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function runIndex() {
        setBusy('重建索引…')
        try {
          const value = await api('memory', { method: 'POST', body: { dir, action: 'index' } })
          setMessage({ kind: 'info', text: `索引已重建：${value.cards} 张卡、${value.settings} 份设定文件` })
          loadMemory(dir)
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      async function pick(kind) {
        const input = kind === 'setting' ? settingInput.current : extraInput.current
        input?.click()
      }

      async function onFiles(kind, fileList) {
        const files = Array.from(fileList ?? [])
        if (files.length === 0) return
        setBusy('读取文件…')
        try {
          const records = []
          for (const file of files) {
            const base64 = await readAsBase64(file)
            records.push({ name: file.name, kind, base64 })
          }
          if (kind === 'setting') setSettings((prev) => [...prev, ...records])
          else setExtras((prev) => [...prev, ...records])
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function runExtract() {
        const target = (url ?? '').trim()
        if (target === '') {
          setMessage({ kind: 'error', text: '先贴一个 DeepSeek 分享链接' })
          return
        }
        setBusy('抓取中：分享内容 + 附件 + 分块…')
        setMessage(null)
        setPreview('')
        try {
          const value = await api('extract', {
            method: 'POST',
            body: {
              url: target,
              outDir: dir || config?.defaultOut,
              uploads: [...settings, ...extras],
            },
          })
          localStorage.setItem(STORE_DIR, dir || config?.defaultOut || '')
          setMessage({ kind: 'info', text: value.report })
          await refresh()
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function runContinue() {
        setBusy('生成接续指令…')
        setMessage(null)
        try {
          const value = await api('continue', { method: 'POST', body: { dir, tailRounds: 8 } })
          setPreview(value.prompt)
          if (inputActions?.setDraft) {
            inputActions.setDraft(value.prompt)
            inputActions.persistDraft?.()
            inputActions.submit?.()
            setMessage({
              kind: 'info',
              text: `已送进输入框并从第 ${value.nextRound} 轮接上（${value.hero} / ${value.girl}）。`
                + (value.inferred ? ' novel.json 是按设定推断的，看一眼名称和当前场景再改。' : '')
                + ' 等它回第一句就行。',
            })
            window.setTimeout(() => { try { onClose?.() } catch { /* ignore */ } }, 500)
          } else {
            try {
              await navigator.clipboard.writeText(value.prompt)
              setMessage({ kind: 'info', text: `接续指令已复制（第 ${value.nextRound} 轮）。回到对话框粘贴发送即可。` })
            } catch {
              setMessage({ kind: 'info', text: '接续指令生成好了，见下方，复制后发到对话框。' })
            }
          }
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      async function runAssemble() {
        setBusy('装配 03 与续接包…')
        setMessage(null)
        try {
          const value = await api('assemble', { method: 'POST', body: { dir, tailRounds: 60 } })
          setMessage({
            kind: 'info',
            text: `装配完成：${value.chapters} 章${value.warnings?.length ? `\n注意：${value.warnings.join('；')}` : ''}`,
          })
          await refresh()
        } catch (error) {
          setMessage({ kind: 'error', text: String(error.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      const canContinue = Boolean(state?.exists && state?.rounds > 1)
      const canAssemble = Boolean(state?.exists && state?.beats > 0 && state?.beats >= (state?.chunks ?? 0))

      const main = h('div', { style: styles.backdrop, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { style: styles.card, onMouseDown: (event) => event.stopPropagation() },
          h('div', { style: styles.head },
            h('div', { style: styles.title }, '小说续接'),
            h('button', { style: styles.ghost, onClick: onClose, title: '关闭' }, '关闭')),
          h('div', { style: styles.hint }, '贴一个分享链接，可以再补上你自己的人设和补充文件；整理好之后一键从这里往下写。'),

          h('div', { style: styles.label }, '分享链接'),
          h('div', { style: styles.row },
            h('input', {
              style: styles.input,
              value: url,
              placeholder: 'https://chat.deepseek.com/share/…',
              onChange: (event) => setUrl(event.target.value),
            })),

          h('div', { style: styles.label }, '工作目录'),
          h('div', { style: styles.row },
            h('input', {
              style: styles.input,
              value: dir,
              placeholder: config?.defaultOut ?? '/path/to/小说整理',
              onChange: (event) => setDir(event.target.value),
              onBlur: () => { localStorage.setItem(STORE_DIR, dir ?? ''); refresh() },
            }),
            h('button', { style: styles.button, onClick: () => openPicker(dir || config?.home || '') }, '选择…'),
            h('button', { style: styles.button, onClick: () => refresh(), title: '刷新状态' }, '刷新')),

          h('div', { style: styles.label }, '原始人设（可多选：txt / md / docx）'),
          h('div', { style: styles.row },
            h('button', { style: styles.button, onClick: () => pick('setting') }, '选择人设文件'),
            h('input', {
              ref: settingInput,
              type: 'file',
              multiple: true,
              accept: '.txt,.md,.docx,text/plain,text/markdown',
              style: { display: 'none' },
              onChange: (event) => { onFiles('setting', event.target.files); event.target.value = '' },
            }),
            h('span', { style: styles.quote }, settings.length > 0 ? `已选 ${settings.length} 个` : '没有就跳过')),
          h('div', null, settings.map((file, index) => h('span', { key: 's' + index, style: styles.file },
            file.name,
            h('button', {
              style: styles.ghost,
              onClick: () => setSettings((prev) => prev.filter((_, i) => i !== index)),
              title: '移除',
            }, '×')))),

          h('div', { style: styles.label }, '补充文件（写法规则、后来的剧情、备注都行）'),
          h('div', { style: styles.row },
            h('button', { style: styles.button, onClick: () => pick('extra') }, '选择补充文件'),
            h('input', {
              ref: extraInput,
              type: 'file',
              multiple: true,
              accept: '.txt,.md,.docx,text/plain,text/markdown',
              style: { display: 'none' },
              onChange: (event) => { onFiles('extra', event.target.files); event.target.value = '' },
            }),
            h('span', { style: styles.quote }, extras.length > 0 ? `已选 ${extras.length} 个` : '没有就跳过')),
          h('div', null, extras.map((file, index) => h('span', { key: 'e' + index, style: styles.file },
            file.name,
            h('button', {
              style: styles.ghost,
              onClick: () => setExtras((prev) => prev.filter((_, i) => i !== index)),
              title: '移除',
            }, '×')))),

          h('div', { style: styles.footer },
            h('button', { style: styles.button, onClick: runExtract, disabled: Boolean(busy) }, busy === '抓取中：分享内容 + 附件 + 分块…' ? '整理中…' : '开始整理'),
            h('button', { style: styles.button, onClick: runAssemble, disabled: Boolean(busy) || !canAssemble, title: canAssemble ? '生成 03 与续接包' : '分章块还没齐' }, '生成续接包')),

          h('div', { style: styles.divider }),
          h('div', { style: styles.label }, '当前状态'),
          h(StateBlock, { state }),

          h('div', { style: styles.divider }),
          h('div', { style: styles.label }, '记忆（滚动记忆 / 知识库）'),
          h('div', { style: styles.quote }, memory
            ? `记忆卡 ${memory.cards} 张，覆盖第 ${memory.from || 0}—${memory.to || 0} 轮；全书 ${memory.totalRound} 轮`
              + (memory.totalRound > memory.to ? `，第 ${memory.to + 1}—${memory.totalRound} 轮还没有卡` : '，覆盖完整')
            : '选好工作目录后这里显示记忆卡覆盖情况'),
          h('div', { style: { ...styles.row, marginTop: '8px', flexWrap: 'wrap' } },
            h('button', { style: styles.button, onClick: runDigest, disabled: Boolean(busy) || !memory }, '生成记忆卡'),
            h('button', { style: styles.button, onClick: runIndex, disabled: Boolean(busy) || !state?.exists }, '重建索引'),
            h('span', { style: styles.quote }, '续接时自动读 设定/ + 最近两张卡 + 索引 + 检索片段')),
          card
            ? h('div', null,
              h('div', { style: styles.label }, `记忆卡底稿（第 ${card.from}—${card.to} 轮，可以直接改）`),
              h('textarea', {
                style: styles.textarea,
                value: card.text,
                onChange: (event) => setCard({ ...card, text: event.target.value }),
              }),
              h('div', { style: styles.footer },
                h('button', { style: styles.button, onClick: () => setCard(null) }, '丢弃'),
                h('button', { style: styles.primary, onClick: runSaveCard, disabled: Boolean(busy) }, '存为记忆卡')))
            : null,

          h('div', { style: styles.divider }),
          h('div', { style: styles.label }, '知识库（工作目录就是大脑）'),
          h('div', { style: styles.quote }, kb && Array.isArray(kb.modules)
            ? `${kb.modules.filter((row) => row.files > 0).length} 个模块有内容，合计 ${kb.modules.reduce((sum, row) => sum + row.chars, 0)} 字`
              + `；续接时按模块取用 ${kb.chars || 0} 字`
            : '选好工作目录后这里显示知识库模块'),
          h('div', { style: { ...styles.row, marginTop: '8px', flexWrap: 'wrap' } },
            h('button', { style: styles.button, onClick: () => runKb('init'), disabled: Boolean(busy) || !state?.exists }, '建知识库'),
            h('button', { style: styles.button, onClick: () => runKb('sync'), disabled: Boolean(busy) || !state?.exists }, '同步知识库'),
            h('button', { style: styles.button, onClick: () => runKb('index'), disabled: Boolean(busy) || !state?.exists }, '重建索引')),
          h('div', { style: styles.quote, marginTop: '6px' },
            '模块：01 剧情（分章）· 02 角色·他 · 03 角色·我 · 04 事件簿 · 05 时间线 · 06 特殊事件 · 07 其他人物 · 08 特殊物品 · 09 生活物品 · 10 规则（按出处拆分）· 11 记忆卡 · 12 情感 · 13 伏笔 · 14 语感 · 15 来源 · 16 世界观 · 17 场景。'
            + '一键继续会把索引与各模块正文按预算读进 prompt，写的时候以它为准。'),

          h('div', { style: styles.footer },
            h('button', {
              style: { ...styles.primary, opacity: canContinue && !busy ? 1 : 0.45 },
              onClick: runContinue,
              disabled: Boolean(busy) || !canContinue,
              title: canContinue ? `从第 ${state.nextRound} 轮继续（没有 novel.json 时按设定自动推断）` : '需要先整理出对话',
            }, canContinue ? `一键继续（第 ${state.nextRound} 轮）` : '一键继续'),
            h('button', { style: styles.button, onClick: () => refresh() }, '刷新状态')),

          busy ? h('div', { style: { ...styles.message, color: COLORS.muted } }, busy) : null,
          message
            ? h('div', { style: { ...styles.message, color: message.kind === 'error' ? '#d33' : 'inherit' } }, message.text)
            : null,
          preview ? h('pre', { style: styles.pre }, preview) : null)
      )

      const pickerLayer = picker
        ? h('div', {
          style: { ...styles.backdrop, zIndex: 2147483002 },
          onMouseDown: (event) => { if (event.target === event.currentTarget) setPicker(null) },
        },
        h('div', { style: { ...styles.card, width: 'min(560px, 100%)' } },
          h('div', { style: styles.head },
            h('div', { style: styles.title }, '选择工作目录'),
            h('button', { style: styles.ghost, onClick: () => setPicker(null) }, '关闭')),
          h('div', { style: styles.quote }, picker.path || '（从主目录开始）'),
          h('div', { style: { ...styles.row, marginTop: '8px', flexWrap: 'wrap' } },
            h('button', {
              style: styles.button,
              disabled: !picker.parent,
              onClick: () => loadPicker(picker.parent ?? ''),
            }, '上一级'),
            h('button', { style: styles.button, onClick: () => loadPicker(config?.home ?? '') }, '主目录')),
          h('div', { style: { maxHeight: '46vh', overflow: 'auto', marginTop: '8px' } },
            picker.loading
              ? h('div', { style: styles.quote }, '读取中…')
              : picker.dirs.length === 0
                ? h('div', { style: styles.quote }, '这里没有子目录')
                : picker.dirs.map((entry) => h('button', {
                  key: entry.path,
                  style: styles.pickerItem,
                  onClick: () => loadPicker(entry.path),
                }, '📁 ' + entry.name))),
          h('div', { style: styles.footer },
            h('button', {
              style: styles.primary,
              onClick: () => {
                const chosen = picker.path
                setPicker(null)
                setDir(chosen)
                localStorage.setItem(STORE_DIR, chosen)
                refresh(chosen)
              },
            }, '用这个目录'))))
        : null

      const body = h(React.Fragment, null, main, pickerLayer)
      return createPortal ? createPortal(body, document.body) : body
    }

    function Chip(props) {
      const [open, setOpen] = useState(false)
      const [state, setState] = useState(null)
      const [dir, setDir] = useState('')
      const [url, setUrl] = useState('')
      const [settings, setSettings] = useState([])
      const [extras, setExtras] = useState([])

      const close = useCallback(() => setOpen(false), [])
      const inputActions = props?.inputActions

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          style: styles.chip,
          title: '小说续接：贴分享链接整理，然后一键往下写',
          onClick: () => setOpen(true),
        }, '📚 小说续接'),
        open
          ? h(Dialog, {
              state,
              setState,
              dir,
              setDir,
              url,
              setUrl,
              settings,
              setSettings,
              extras,
              setExtras,
              onClose: close,
              inputActions,
            })
          : null)
    }

    const inject = ['slots']

    function register(ctx) {
      return ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'dsh-novel-archive',
        order: 8,
      }, Chip))
    }

    function apply(ctx) {
      if (typeof ctx.effect === 'function') ctx.effect(() => register(ctx), 'dsh-novel-archive: composer chip')
      else register(ctx)
    }

    return { inject, apply }
  },
})
