# 念行

念行是一款本地优先的个人行动与灵感 PWA。一个输入口同时承接任务、明日计划、学习问题和临时想法；AI 只生成可审阅的整理草稿，最终保存始终由用户确认。

## 核心能力

- 今天、28 天全景和灵感库三种时间尺度。
- 自然语言或语音捕捉，本地解析可在离线状态继续工作。
- 本机先写，登录后可按用户同步到 Sites D1。
- 通过 revision、更新时间和删除墓碑合并离线与并发修改。
- DeepSeek 是可选的服务端增强项；未配置密钥时产品仍可完整使用。
- Compact / Tall 两种纯 CSS 中性设备预览，不包含第三方手机、键盘或状态栏素材。

## 架构边界

浏览器只调用同域 `/api/organize`，不会接触模型 API Key。Sites Worker 使用平台注入的登录身份隔离 D1 数据，并对模型调用进行按用户限流。模型输出不能直接写入任务或灵感。

`oai-authenticated-user-*` 请求头只应在 OpenAI Sites 的受控运行时中被信任。如果将 Worker 部署到其他平台，必须在受信任的代理层删除外部同名请求头并重新实现可验证身份，不能直接复用当前信任边界。

## 本地运行

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
```

完整验证：

```bash
npm run check:runtime
npm run build
npm run test:sites
```

如需启用本地 AI 代理，将 `.env.example` 复制为 `.env`，仅在服务端填写 `DEEPSEEK_API_KEY`，再运行 `npm run ai:proxy`。不要把 `.env` 提交到 Git。

## Sites 配置

仓库中的 `.openai/hosting.json` 只声明逻辑 D1 绑定，不含任何现有站点的 `project_id`。在自己的 Sites 项目中创建或关联站点后，由该项目写入自己的部署标识和秘密变量。

## 文档

- [产品需求](docs/product/requirements.md)
- [系统架构](docs/architecture/architecture.md)
- [本地优先决策](docs/architecture/ADR-001-local-first.md)
- [模型网关决策](docs/architecture/ADR-002-model-gateway.md)
- [账号云同步决策](docs/architecture/ADR-003-account-cloud-sync.md)
- [安全边界](SECURITY.md)
- [隐私说明](PRIVACY.md)

## 使用许可

当前仓库用于作品审阅与技术讨论，尚未授予第一方代码或素材的复用许可。依赖项继续适用各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
