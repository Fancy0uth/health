# 当前接口契约

所有接口由同一个 Node 业务服务提供。当前为一个合成演示档案；正式账号和字段级事务在后续迭代实现。跨设备同步依赖服务端 SQLite，localStorage 不作为共享真相源。

| 方法与路径 | 请求 | 返回 |
| --- | --- | --- |
| GET /api/health | 无 | storage、profile、agent 状态 |
| GET /api/state | 无 | revision、state |
| PUT /api/state | state、expected_revision | 新 revision、state；冲突 HTTP 409 |
| POST /api/health-assistant | question | HTTP 202 的 run_id |
| POST /api/health-record | text | HTTP 202 的 run_id |
| POST /api/medical-document | text，JSON | HTTP 202；Multipart/PDF 尚不支持 |
| POST /api/visit-preparations | current_concern、selected_record_ids | HTTP 202 的 run_id |
| GET /api/runs/{id} | 无 | status、phase、result_ref、error |
| POST /api/runs/{id}/cancel | 空 JSON 对象 | 当前状态；不撤销既有效果 |
| GET /api/results/{id} | 无 | 工作流结果及 agh 会话元数据 |

错误统一为 `{ "error": { "code": "...", "message": "..." } }`。HTTP 202 表示已接收，未完成。queued/running 可取消；failed/interrupted 不伪造成功。模型错误正文、凭证和内部异常不返回浏览器。

## Agent 结果

- assistant：answer、action（home/timeline/visit/null）。
- daily_record：description、date（YYYY-MM-DD 或 null）。
- medical_document：original（服务端保留输入原文）、date、onset、task；未知为 null。
- visit_preparation：speech、questions。
- agh：session_id、last_seq、provider、model，仅从 SDK 实际回执生成。

这些兼容原型字段不代表完整事实 Schema。后续需加 fact_id、source_id、原文定位、review_status、有效时间、依赖 revision 和字段级确认凭证。
