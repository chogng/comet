# Nireco Editor 架构与契约

Nireco 是 Comet Editor 层内建的结构化学术文稿引擎。它不是独立仓库、独立包、运行时插件、跨仓协议或 Agent SDK。它与 Comet 的关系不是“外部编辑器被产品适配”，而是 Editor 模型、事务、历史和浏览器视图直接组成 Comet 的编辑基础设施。

Nireco 的核心是：

```text
URI resource
+ immutable Revision
+ Semantic Position
+ atomic Transaction
```

每个活动文稿由一个 Comet `URI` 标识。Revision 标识该文稿的不可变状态，Semantic Position 标识该状态中的语义位置，Transaction 是产生下一 Revision 的唯一正文变更单位。

## 核心不变量

1. `IManuscriptModel` 是正文、学术图、Revision 和 durability 状态的唯一运行时权威。
2. 同一资源比较键在一个 `IManuscriptModelService` 中最多对应一个活动模型。
3. Browser View、DOM、输入缓冲、`EditorPane`、`EditorInput`、Selection、Agent Task 和存储镜像都不是文档权威。
4. 所有编辑都通过针对明确 `baseRevisionId` 的 Transaction 原子提交。
5. 所有异步读取、Proposal、诊断、保存和 Agent 操作都绑定明确 Revision；不存在隐式“当前活动 Editor”替代。
6. Selection 和 composition 属于具体浏览器 View；多个 View 可以共享一个模型并保持独立 Selection。
7. Agent 只能创建、修改、验证和提交 Proposal 供审阅；Agent 没有主分支 commit、raw transaction、storage write 或 review accept 能力。
8. 资源身份使用 Comet `URI` 和资源比较函数；Editor 不实现第二套 URI、事件、生命周期、取消、Observable、依赖注入或基础存储系统。
9. Kernel reducer、replay 和 normalization 不读取时钟、随机数、DOM、网络或存储。
10. 缺失能力、无效输入、Revision 冲突、持久化故障和投影分歧都显式失败；不存在兼容别名、回退权威、静默截断或 invalid-to-empty 路径。

## 分层与所有权

```text
Platform generic services
  URI / Event / Lifecycle / Cancellation / DI / durable byte storage
                              ↓
Editor common
  identifiers / model / transaction / revision / proposal / services
                              ↓
Editor browser
  view model / rendering / input / hit testing / selection / composition
                              ↓
Workbench draftEditor
  EditorInput / EditorPane / save-revert / Agent tools / review surfaces
                              ↓
Sessions and Agent Host
  product workflow / task policy / generic Tool transport and execution
```

依赖方向只允许向下。Editor common 不导入 Browser、Node、Electron、Workbench、Sessions 或 Agent Host。Platform 不导入 Editor。Workbench `draftEditor` 可以消费 Editor 的公共契约；Platform Agent Host 保持 Feature-neutral，不导入 Editor 或 Draft Editor。

### 最终源码布局

```text
src/cs/editor/
├── NIRECO.md
├── editor.all.ts
├── common/
│   ├── core/
│   │   ├── boundedClosedJson.ts
│   │   ├── canonicalJson.ts
│   │   ├── canonicalTimestamp.ts
│   │   ├── canonicalUri.ts
│   │   ├── identifiers.ts
│   │   ├── hashPreimage.ts
│   │   ├── sha256.ts
│   │   ├── semanticPosition.ts
│   │   ├── manuscriptResource.ts
│   │   └── manuscriptModelError.ts
│   ├── model.ts
│   ├── model/
│   │   ├── actor.ts
│   │   ├── manuscript.ts
│   │   ├── manuscriptSchema.ts
│   │   ├── snapshot.ts
│   │   ├── snapshotDecoder.ts
│   │   ├── documentIndex.ts
│   │   ├── merkleVector.ts
│   │   ├── revisionMerkleState.ts
│   │   ├── academicGraph.ts
│   │   ├── operation.ts
│   │   ├── transaction.ts
│   │   ├── transactionKernel.ts
│   │   ├── positionMap.ts
│   │   ├── inverse.ts
│   │   ├── revision.ts
│   │   ├── proposal.ts
│   │   ├── semanticEdit.ts
│   │   └── semanticDiff.ts
│   └── services/
│       ├── model.ts
│       ├── modelService.ts
│       ├── resolverService.ts
│       ├── historyService.ts
│       ├── durability.ts
│       ├── documentReadService.ts
│       └── proposalService.ts
├── browser/
│   ├── services/
│   ├── controller/
│   │   ├── editorController.ts
│   │   ├── commandController.ts
│   │   └── compositionController.ts
│   ├── input/
│   │   ├── textInput.ts
│   │   ├── clipboard.ts
│   │   └── inputEvent.ts
│   ├── view/
│   │   ├── editorView.ts
│   │   ├── viewModel.ts
│   │   ├── documentProjection.ts
│   │   ├── selectionController.ts
│   │   └── viewState.ts
│   ├── widget/
│   │   └── manuscriptEditorWidget.ts
│   └── pdf/
├── contrib/
│   ├── formatting/browser/
│   └── figure/browser/
└── test/
    ├── common/
    │   ├── core/
    │   ├── model/
    │   ├── services/
    │   └── performance/
    └── browser/
```

`editor.all.ts` 是 Editor-owned browser registration 的唯一聚合入口。Workbench shell 只加载该入口，不直接 side-effect import Editor 内部 service 或 contribution。`common/model.ts` 定义 `IManuscriptModel` 及其公共事件和结果，`common/model/**` 保存纯领域值与确定性变换，`common/services/model.ts` 定义 DI 服务契约，`modelService.ts` 管理活动模型，`resolverService.ts` 管理资源到引用计数模型引用的解析。

目录职责遵循上游 Monaco Editor 的组织规则，而不是复制一棵平行的 Nireco 子树：

- `common` 和 `browser` 只包含缺失后 Editor 本身不能成立的 core；
- `contrib/<feature>` 包含可移除的 Editor 能力，可以依赖 `browser`，每个 feature 自己拥有需要的 `common`、`browser` 和 `test` 子目录；
- 产品专属的 Input、Pane、Agent Tool 和 review UI 留在 `src/cs/workbench/contrib/draftEditor`，不下沉到 Editor `contrib`；
- 当前没有独立发布的 Comet standalone editor，因此不创建空的 `standalone`、API facade 或打包入口；将来只有真实 standalone distribution 才能拥有该目录，且其他目录不得依赖它；
- 测试镜像被测层：环境无关测试在 `test/common`，真实 DOM、Selection、IME 和 input 测试在 `test/browser`，contribution 测试随 feature 放置。

现有 `browser/text` 是待删除的旧 Writing Editor/ProseMirror 实现，不是目标基座。新实现直接进入 `browser/controller`、`browser/input`、`browser/view` 和 `browser/widget`；迁移完成时删除旧目录及全部 ProseMirror 依赖。Formatting toolbar、style presets、figure resize handles 等可移除能力迁入对应 `contrib`，不会进入 browser core。

不增加 `index.ts`、公共 barrel、`nireco.ts` facade、兼容 re-export 或内部包入口。调用方直接导入拥有该契约的具体模块。

### 邻接层所有权

| 最终路径 | 所有权 |
|---|---|
| `src/cs/platform/storage/common/durableStorage.ts` | 与 Editor 无关的 fenced durable byte-storage contract |
| `src/cs/editor/common/**` | 文稿模型、事务、Revision、Proposal 和环境无关服务 |
| `src/cs/editor/browser/**` | Editor-owned view model、DOM rendering、输入、命中测试、Selection 与 composition |
| `src/cs/editor/contrib/**` | 可移除且仍属于 Editor 的 browser feature |
| `src/cs/workbench/contrib/draftEditor/**` | typed input/pane、保存与恢复、Agent session/grant/cursor、Tool 和审阅产品面 |
| `src/cs/platform/agentHost/**` | Feature-neutral Agent、Tool、内容资源和连接协议 |
| `src/cs/sessions/**` | 产品 Task、Context、权限策略和布局 |

PDF Editor 保持 `browser/pdf` sibling。PDF 阅读、批注和渲染不会被强行建模成可编辑 Manuscript，也不会成为 Manuscript 文档权威。

## Comet 基座复用

| 能力 | 唯一基础 |
|---|---|
| 资源值 | `URI` from `cs/base/common/uri` |
| 资源相等性和 Map key | `isEqual` / `getComparisonKey` from `cs/base/common/resources` |
| 事件 | `Event` / `Emitter` from `cs/base/common/event` |
| 生命周期 | `Disposable` / `DisposableStore` / `MutableDisposable` / `toDisposable` |
| 取消 | `CancellationToken` / `CancellationTokenSource` / `CancellationError` |
| 依赖注入 | `createDecorator`、构造函数注入、`registerSingleton` |
| 状态观察 | Comet Observable；正文 commit occurrence 使用 Event |
| 普通应用设置 | `IStorageService` |
| WAL 与 Snapshot | Platform fenced durable byte storage |

模型内容权威不由多个 Observable 字段拼接。提交发生通过 Event 发布，当前状态通过同一模型的 immutable snapshot 查询。异步 WAL flush 是显式操作，不伪装成异步 `dispose()`。

## 资源身份

`IManuscriptModel.resource` 是 `URI`，不是 branded string。活动模型表使用 `getComparisonKey(resource)`，协议和哈希使用经过文稿资源校验后的 canonical serialization；两者不能互换。

第一方未命名文稿使用 `comet-draft:` scheme：

```text
comet-draft:<canonical-lowercase-uuidv7>
```

其 authority、query 和 fragment 必须为空，path 必须是 canonical lowercase UUIDv7。文稿逻辑身份不包含标题、Revision、文件路径或窗口 ID。物理文件、远程对象和备份位置由 storage binding 管理，不替代逻辑资源。

`manuscriptResource.ts` 负责：

- 校验允许的精确 scheme 和每个 scheme 的结构；
- 产生用于持久协议和哈希的 canonical resource string；
- 拒绝非 canonical 编码、可变 query/fragment 和不受支持的 scheme；
- 保持 canonical serialization 与 `getComparisonKey` 的职责分离。

Resolver provider 按精确 scheme 注册。重复注册立即失败；解析时不使用 priority、不尝试下一个 provider，也不把不受支持的 URI 转成空文稿。

## 标识与可信分配

Editor common 只定义 Editor 领域身份：

```typescript
type RevisionId = Brand<string, 'RevisionId'>;
type TransactionId = Brand<string, 'TransactionId'>;
type OperationId = Brand<string, 'OperationId'>;
type NodeId = Brand<string, 'NodeId'>;
type EntityId = Brand<string, 'EntityId'>;
type ProposalId = Brand<string, 'ProposalId'>;
type ProposalChangeGroupId = Brand<string, 'ProposalChangeGroupId'>;
type ContentHash = Brand<string, 'ContentHash'>;
type Utf16Offset = Brand<number, 'Utf16Offset'>;
```

Workspace、Agent session、capability grant、Tool call 和 debug correlation 身份由其拥有层定义，不进入 Editor core。

Revision、Transaction、Operation、Node、Entity 和 Proposal ID 使用 canonical lowercase RFC 9562 UUIDv7。`ProposalChangeGroupId` 使用从冻结 identity digest 前 16 bytes 派生的 canonical lowercase RFC 9562 UUIDv8。

可信分配遵守：

- 时钟和密码学熵只在注入的 identity service 边界读取；
- Browser seed source 只使用 `crypto.getRandomValues`；缺失时显式失败，不使用 `Math.random`；
- 同毫秒和时钟回退时 allocator 维持 UUID 字节序单调；
- 时钟不可用、密码学熵不可用和计数空间耗尽分别报告
  `IDENTITY_CLOCK_UNAVAILABLE`、
  `IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE` 和
  `IDENTITY_SEQUENCE_EXHAUSTED`；
- reducer、normalizer、replay、schema 和 view projection 都不生成 ID；
- Operation ID 在 Transaction 或 Proposal 编译时分配一次，并与 Operation 一起持久化；
- Browser view、input 和 command controller 不补 ID；
- Agent 模型输入只能使用临时 `clientRef`，正式 ID 由 Workbench 的受信 Tool executor 请求 identity service 后注入。

## Canonical JSON、SHA-256 与哈希前像

Canonical JSON 接受 closed plain JSON values，并执行以下规则：

- object key 按 Unicode code point 排序；
- array 顺序保留且禁止 sparse array；
- 数字必须有限并使用确定性 JSON 表达；
- 字符串必须是 well-formed Unicode，但不执行 NFC/NFD normalization；
- accessor、symbol key、Proxy inspection failure、非 plain prototype、循环引用和超限深度显式失败；
- 不调用输入 getter，也不把异常对象转换成普通对象。

所有 Editor 领域哈希使用 portable synchronous SHA-256。Editor common 不导入 Node `crypto`，也不维护 Node 与 Browser 两套生产算法。Node `crypto` 只可在测试中作为 oracle。

冻结前像：

```text
UTF8(
  "NIRECO\0HASH\0V1\0"
  + domain
  + "\0"
  + canonicalJson(payload)
)
```

输出格式固定为：

```text
sha256:<64 lowercase hexadecimal digits>
```

冻结 domain：

| 值 | 语义 |
|---|---|
| `nireco.document-content.v1` | 规范文稿内容 |
| `nireco.node.v1` | 单节点内容 |
| `nireco.transaction.v1` | 持久 Transaction |
| `nireco.academic-entity.v1` | 学术实体 |
| `nireco.semantic-diff.v1` | Semantic Diff |
| `nireco.proposal-change-group.v1` | Change Group identity |

Hash domain、prefix、canonical JSON profile、URI serialization 和 payload shape 都是协议的一部分；不得在调用点手写拼接。

### 增量 Merkle 内容哈希

`documentHash` 不通过序列化整份 Snapshot 计算。六个既有 domain 的职责固定如下：

- `nireco.node.v1`：完整 node subtree；
- `nireco.academic-entity.v1`：Reference Snapshot、Evidence Link、Claim 和 Claim–Evidence relation item；
- `nireco.document-content.v1`：metadata positional Merkle vector、keyed structural Merkle sequence、metadata、settings、Academic Graph aggregate 和 document root；
- 其余三个 domain 只用于 Transaction、Semantic Diff 和 Change Group。

同一 domain 内的每个 payload 都包含 exact、带版本的 `algorithm` 以及 `kind`、`role` 或 `type` discriminator，禁止不同语义对象替换。

Metadata positional Merkle vector 的 fanout 固定为 32，使用
`nireco.document-content.v1`：

```typescript
type MerkleVectorPayload =
	| {
		readonly algorithm: 'nireco-merkle-vector-1';
		readonly fanout: 32;
		readonly kind: 'empty';
		readonly role: PositionalMerkleRole;
		readonly count: 0;
	}
	| {
		readonly algorithm: 'nireco-merkle-vector-1';
		readonly fanout: 32;
		readonly kind: 'leaf';
		readonly role: PositionalMerkleRole;
		readonly level: 0;
		readonly count: number;
		readonly items: readonly ContentHash[];
	}
	| {
		readonly algorithm: 'nireco-merkle-vector-1';
		readonly fanout: 32;
		readonly kind: 'branch';
		readonly role: PositionalMerkleRole;
		readonly level: number;
		readonly count: number;
		readonly children: readonly {
			readonly count: number;
			readonly hash: ContentHash;
		}[];
	};
```

Positional exact role 只有：

```text
metadata-authors
metadata-keywords
```

非空输入从左到右每 32 个 item hash 形成 `level: 0` leaf；每 32 个相邻
child descriptor 形成高一层 branch，直到只剩一个 root。Leaf 的 `count`
等于 `items.length`，branch 的 `count` 等于 child count 之和。空 vector
使用唯一 empty payload。不补空节点、不按编辑历史平衡、不静默排序。同长
单项替换只重算一个 leaf 和每层一个 branch；count 或 semantic order 改变时
按实际 positional rebuild 计量。

Node children 与四个 Academic collection 使用 keyed structural Merkle
sequence，同样复用 `nireco.document-content.v1`，不得增加新 hash domain：

```typescript
type StructuralMerkleRole =
	| 'manuscript-node-children'
	| 'academic-reference-snapshots'
	| 'academic-evidence-links'
	| 'academic-claims'
	| 'academic-claim-evidence-relations';

type StructuralMerkleKey =
	| { readonly kind: 'node'; readonly nodeId: NodeId }
	| { readonly kind: 'academic-entity'; readonly entityId: EntityId }
	| {
		readonly kind: 'academic-relation';
		readonly claimId: EntityId;
		readonly evidenceId: EntityId;
	};

type StructuralMerklePayload =
	| {
		readonly algorithm: 'nireco-structural-merkle-sequence-1';
		readonly kind: 'entry';
		readonly role: StructuralMerkleRole;
		readonly key: StructuralMerkleKey;
		readonly itemHash: ContentHash;
		readonly nextKey: StructuralMerkleKey | null;
	}
	| {
		readonly algorithm: 'nireco-structural-merkle-sequence-1';
		readonly kind: 'patricia-leaf';
		readonly role: StructuralMerkleRole;
		readonly pathSuffix: string;
		readonly key: StructuralMerkleKey;
		readonly entryHash: ContentHash;
	}
	| {
		readonly algorithm: 'nireco-structural-merkle-sequence-1';
		readonly kind: 'patricia-branch';
		readonly role: StructuralMerkleRole;
		readonly prefix: string;
		readonly children: readonly {
			readonly edge: number;
			readonly hash: ContentHash;
		}[];
	}
	| {
		readonly algorithm: 'nireco-structural-merkle-sequence-1';
		readonly kind: 'root';
		readonly role: StructuralMerkleRole;
		readonly count: number;
		readonly headKey: StructuralMerkleKey | null;
		readonly patriciaRootHash: ContentHash | null;
	};
```

Formal key 由 role 唯一约束。Node 和 Academic Entity path 是 canonical
lowercase UUID 去掉 `-` 后的 32 个 hex nibble；relation path 是
`claimId + evidenceId` 的 64 个 nibble。`prefix` 和 `pathSuffix` 只含
lowercase hex，允许空串。Branch 有 2..16 个 child；edge 是 0..15 的唯一
升序 nibble，每层 edge 恰好消费一个 nibble。Singleton root 直接指向 leaf；
删除产生单 child 时必须合并 prefix。

空 root 精确为 `count: 0`、`headKey: null`、`patriciaRootHash: null`。
非空时 `headKey`、Patricia size 和 `count` 必须一致。从 `headKey` 沿每个
entry 的 `nextKey` 必须恰好访问全部唯一 entry 后以 `null` 结束，因此
key set、item hash 和 semantic order 都被提交。Patricia shape 只由 key set
决定；相同 key/hash/order 无论编辑历史如何都必须与独立 full rebuild 得到
相同 root。输入顺序变化是 semantic order 变化，应改变 sequence root。

Structural insert/remove/move 只修改常数个 linked entry 和各自最多 32/64
nibble 的 Patricia path；禁止 ordinal rebuild、generic set、parent-wide
membership scan 或按编辑历史决定 tree shape。Node children 保留 schema
semantic order，不排序；Academic collection 的 canonical order 仍由 decoder
严格验证。Structural exact role 只有：

```text
manuscript-node-children
academic-reference-snapshots
academic-evidence-links
academic-claims
academic-claim-evidence-relations
```

Node payload 使用 `nireco.node.v1` 和 `algorithm: 'nireco-manuscript-node-1'`。Text payload 精确包含 `id`、`type: 'text'`、`value` 和 canonical marks。非 Text node 精确包含 `id`、`type`、closed `attrs`；schema 定义拥有 children 的 node 还包含 `{ count, hash }` keyed child-sequence descriptor，即使 children 为空。URI attr 先编码为 canonical string，optional 字段缺失时省略。Node hash 是 subtree hash：child sequence item 是 child subtree hash，任一 descendant 变化只沿父路径更新到 manuscript root。

用于判断 node 本地字段是否变化的 comparison payload 与正式 Node hash
payload 是两个不同的 closed type。Comparison payload 不含 hash algorithm，
也不能传给 Revision hash helper；正式 container payload 缺少 keyed
child-sequence descriptor、Text 或 leaf payload 多出该 descriptor 都在类型和
运行时边界拒绝。

Academic entity payload 使用 `nireco.academic-entity.v1` 和 `algorithm: 'nireco-academic-entity-1'`。Reference Snapshot、Evidence Link、Claim 和 relation 分别使用 exact `type`。Snapshot 不保存可派生的 `metadataHash`、`textHash` 或 `excerptHash`；Evidence 的 `sourceContentHash` 是 Source-owned identity，必须保留。Reference、Evidence 和 Claim 数组按 canonical lowercase `EntityId` 严格升序；relation 按 `(claimId, evidenceId)` 严格升序且 pair 唯一。Decoder 遇到乱序直接拒绝。四个 collection 各自进入 exact-role keyed structural sequence，Academic Graph root payload 固定为：

```typescript
interface AcademicGraphHashPayload {
	readonly algorithm: 'nireco-academic-graph-1';
	readonly referenceSnapshots: MerkleVectorDescriptor;
	readonly evidenceLinks: MerkleVectorDescriptor;
	readonly claims: MerkleVectorDescriptor;
	readonly claimEvidenceRelations: MerkleVectorDescriptor;
}
```

Metadata 使用 `nireco.document-content.v1` 和 `algorithm: 'nireco-manuscript-metadata-1'`。Title 与 abstract 各自是带 exact `field` 的 `text-field` payload；每个 author 和 keyword 各自有 closed payload；root 只聚合 `titleHash`、authors positional vector、`abstractHash` 和 keywords positional vector。Author 顺序保留署名语义；author affiliations 和 keywords 是 set-like，必须按 Unicode code point 严格升序且唯一。

Settings payload 使用 `algorithm: 'nireco-manuscript-settings-1'`，精确包含 language、citation style、heading numbering 和 bibliography enabled。最终 document root payload 使用 `nireco.document-content.v1`：

```typescript
interface DocumentMerklePayload {
	readonly algorithm: 'nireco-document-merkle-1';
	readonly schemaId: 'nireco.manuscript';
	readonly schemaVersion: string;
	readonly metadataHash: ContentHash;
	readonly rootNodeHash: ContentHash;
	readonly academicGraphHash: ContentHash;
	readonly settingsHash: ContentHash;
}
```

`format`、`formatVersion`、`revisionId`、顶层 manuscript resource、`documentHash` 自身、durability、index 和 cache 不进入 document root。Claim anchor 内显式绑定的 resource/revision 属于 Claim 内容，不是顶层模型身份。

每个 Revision 的私有 `RevisionMerkleState` 与 Snapshot 原子安装，持有
aggregate roots、`NodeId → subtree hash`、`EntityId → entity hash`、
positional metadata vectors 和 keyed structural sequences。内容 lookup
始终以领域 ID、Revision 或 formal relation key 为键，不以 object identity
代替内容身份。状态不进入 Snapshot、WAL、manifest、Tool result 或公共模型
API，Revision 淘汰时一并释放。

Snapshot decoder 不信任外部 cache，必须独立执行：

```text
strict decode
→ post-order node hashes and keyed child sequences
→ entity hashes and keyed structural collection sequences
→ Academic Graph root
→ metadata and settings roots
→ document root
→ compare declared documentHash
```

Reducer 只从已完整验证的 base Revision state copy-on-write 更新明确 changed
ID 和 ancestor path。Read service 的 `nodeHash` 直接读取该 Revision state。
禁止 Snapshot trust marker、整份 canonical string substring patch 或完整
Snapshot UTF-8 cache。

### Change Group identity

`ProposalChangeGroupId` 的 identity payload 固定包含：

```typescript
interface ProposalChangeGroupIdentityPayload {
	readonly algorithm: 'nireco-proposal-change-group-1';
	readonly documentUri: string;
	readonly generatedAgainstRevisionId: RevisionId;
	readonly proposalId: ProposalId;
	readonly proposalRevision: number;
	readonly kind: ProposalChangeGroupKind;
	readonly targetRefs: readonly CanonicalSemanticTargetRef[];
	readonly operationIds: readonly OperationId[];
}
```

`documentUri` 是经过校验的 canonical manuscript resource string。`targetRefs` 按领域 normalization 结果编码。`operationIds` 保持 Proposal compiler 的持久化编译顺序，不按 UI 展示、DOM 顺序或对象枚举顺序重建。identity payload 使用 `nireco.proposal-change-group.v1` 计算 SHA-256，再将 digest 前 16 bytes 设置 RFC 9562 version/variant bits 得到 UUIDv8。

同一 Proposal Revision 和生成目标 Revision 的相同规范输入必须产生相同 Group ID。Proposal 内容变化或成功 rebase 产生新 Proposal Revision 和新 Group ID；旧新 Group 通过显式 `supersedes` 关系关联。

## 文稿模型

### 公共模型契约

`common/model.ts` 拥有公共模型形状：

```typescript
interface IManuscriptModel extends IDisposable {
	readonly resource: URI;
	readonly headRevisionId: RevisionId;
	readonly onDidChangeContent: Event<IManuscriptContentChangedEvent>;
	readonly onDidChangeDurability: Event<IManuscriptDurabilityChangedEvent>;
	readonly onDidEnterReadOnly: Event<IManuscriptReadOnlyEvent>;
	readonly onWillDispose: Event<void>;

	getSnapshot(revisionId?: RevisionId): DocumentSnapshot;
	applyTransaction(
		transaction: Transaction,
		token: CancellationToken,
	): Promise<CommitResult>;
	getDurability(revisionId: RevisionId): DurabilityLevel;
	whenDurable(
		revisionId: RevisionId,
		target: DurabilityLevel,
		token: CancellationToken,
	): Promise<DurabilityAcknowledgement>;
}
```

无参数 `getSnapshot()` 只用于同一同步调用栈中的 UI 查询。异步、持久化、Proposal、诊断和 Agent 路径必须传明确 Revision。

公共异步 API 抛出带稳定 `code` 和结构化数据的 `ManuscriptModelError`。纯 parser 和 validator 可以返回局部 discriminated union；Editor 不迁移一套全局 `Result<T, NirecoError>` 基础设施。

### Snapshot

`DocumentSnapshot` 是 immutable canonical state：

```typescript
interface DocumentSnapshot {
	readonly format: 'nireco-document';
	readonly formatVersion: '1';
	readonly schemaId: 'nireco.manuscript';
	readonly schemaVersion: '1';
	readonly revisionId: RevisionId;
	readonly documentHash: ContentHash;
	readonly metadata: ManuscriptMetadata;
	readonly root: ManuscriptNode;
	readonly academicGraph: AcademicGraphSnapshot;
	readonly settings: DocumentSemanticSettings;
}
```

Snapshot 顶层不包含 manuscript URI、DOM、Selection、ViewState、durability、provider、网络句柄、缓存或临时索引。URI 由模型和 revision-bound reference 提供。相同 Snapshot 可以用于持久化、导出和 conformance，但在线操作始终携带资源与 Revision。

运行时 node attribute、Reference、Evidence 和 Anchor 中的资源值使用 Comet `URI`；版本化持久 DTO 和 hash payload 使用经过其拥有层校验的 canonical string。`decodeDocumentSnapshot(value, expectedResource, limits)` 从 `unknown` 做一次 descriptor-safe closed decode，校验所有 URI、ID、预算、schema、graph reference、anchor resource 和 declared hash，并返回 Snapshot、DocumentIndex 与独立重建的 Revision Merkle state。

Immutable installation 只冻结 Manuscript 自己拥有的 plain record 和 array。不得递归 freeze `URI`，因为它是 Comet 基座值对象并拥有惰性内部缓存；不得把“已经 frozen”当成已验证证据。

### 唯一正文表示

结构树只使用一种正文表示：

```typescript
interface ParagraphNode {
	readonly id: NodeId;
	readonly type: 'paragraph';
	readonly attrs: ParagraphAttributes;
	readonly children: readonly InlineNode[];
}

type InlineNode =
	| TextNode
	| CitationNode
	| CrossReferenceNode
	| InlineEquationNode
	| FootnoteReferenceNode
	| HardBreakNode;
```

Citation、CrossReference 和 InlineEquation 是原子 inline node，不使用占位字符或普通文本降级。不存在并行的 `text` 字段、`TextSpan[]`、browser-local JSON/DOM 正文和结构化 children 权威。

内置 Manuscript schema 至少表达：

- manuscript、frontMatter、body、section；
- heading、paragraph、blockQuote、codeBlock、list、listItem；
- text、marks、hardBreak；
- citation、crossReference、inlineEquation、displayEquation；
- figure、figureAsset、figureCaption；
- table、tableRow、tableCell、tableCaption；
- footnote、footnoteReference、bibliographyPlaceholder。

不支持的结构在解析边界显式拒绝。当前 schema 不定义 `unsupportedNode`、opaque extension bag 或只读降级节点；需要保真导入新结构时，先版本化扩展 schema、codec、hash、projection 和测试。投影层不得静默压平成文本、丢字段或创建空文档。

相邻且 marks 相同的 TextNode 合并时保留左 ID，并在 PositionMap 中记录右 ID 的 alias/tombstone。拆分时左片段保留 ID，右片段使用 Transaction 构造前分配的 ID。Normalization 只能作为 Transaction 的确定性阶段发生。

## Semantic Position 与 Anchor

跨层文本 offset 使用 UTF-16 code unit：

```typescript
type SemanticPosition = TextPosition | NodeBoundaryPosition;

interface TextPosition {
	readonly kind: 'text';
	readonly textNodeId: NodeId;
	readonly utf16Offset: Utf16Offset;
	readonly affinity: 'before' | 'after';
}

interface NodeBoundaryPosition {
	readonly kind: 'node-boundary';
	readonly parentNodeId: NodeId;
	readonly childIndex: number;
	readonly affinity: 'before' | 'after';
}
```

Offset 必须位于合法范围且不得落在 surrogate pair 中间。光标移动、删除和 Selection 扩展按 grapheme cluster；正文不会被隐式 Unicode normalization。

Selection 是 View 状态：

```typescript
interface EditorSelection {
	readonly ranges: readonly SemanticRange[];
	readonly primaryRangeIndex: number;
	readonly direction: 'forward' | 'backward';
}
```

持久批注、Claim 和 Proposal 使用绑定资源与 Revision 的 `PersistentAnchor`：

```typescript
interface PersistentAnchor {
	readonly document: {
		readonly resource: URI;
		readonly revisionId: RevisionId;
	};
	readonly primary: SemanticPosition;
	readonly targetNodeId?: NodeId;
	readonly textQuote?: {
		readonly exact: string;
		readonly prefix?: string;
		readonly suffix?: string;
	};
	readonly pathHint?: readonly NodeId[];
}
```

同文档 Anchor 的 resource 必须与模型 resource 相等，但 Anchor Revision 是创建或最近一次显式 reanchor 的绑定点，不要求等于当前 Snapshot Revision。普通 commit 不重写全部 Claim anchor；读取时通过保留的 PositionMap chain 映射到目标 Revision，只有实际受影响的 Claim、用户显式 reanchor 或受控 compaction 才更新 Anchor。History compaction 前必须先把仍引用待删除 Revision 的 Anchor 迁移到保留 Revision。

恢复顺序为 PositionMap、稳定 node ID、text quote、path hint；无法唯一恢复时返回 `ambiguous` 或 `orphaned`，不自动选择最近位置。

## Transaction 与 PositionMap

Operation 是最小确定性状态变换。每个 Operation：

- 在进入 reducer 前已有持久 UUIDv7 `OperationId`；
- 可 canonical serialize 和 replay；
- 声明目标、前置条件和所有正式 ID；
- 产生 PositionMap fragment；
- 产生 inverse operation 或 inverse payload；
- 不读取 DOM、时钟、随机数、网络或存储；
- 不隐式改变无关节点。

最终 primitive union 只有：

```typescript
type Operation =
	| InsertNodeOperation
	| DeleteNodeOperation
	| MoveNodeOperation
	| ReplaceTextOperation
	| SplitTextOperation
	| JoinTextOperation
	| SetNodeAttributesOperation
	| SetTextMarksOperation
	| CreateAcademicEntityOperation
	| ReplaceAcademicEntityOperation
	| DeleteAcademicEntityOperation
	| SetClaimEvidenceRelationOperation
	| SetMetadataOperation
	| SetSettingsOperation;
```

`InsertNode` 携带 step-local `expectedParentHash`，插入 subtree 的全部 Node ID 已预分配；修改已有 node/entity 的 operation 携带执行前 draft state 的 `expectedNodeHash` 或 `expectedEntityHash`。`SplitText` 显式携带预分配的右 Text ID；`JoinText` 保留左 ID 并记录右 ID alias/tombstone。Marks 属于完整 TextNode，范围格式化编译为 `SplitText + SetTextMarks`，不存在无法确定 ID 的 range add/remove mark。Academic entity 更新使用完整 typed replacement，不提供 arbitrary field patch 或 generic link/unlink relation。

`Transaction` 针对一个资源和一个明确 Base Revision：

```typescript
interface Transaction {
	readonly id: TransactionId;
	readonly resource: URI;
	readonly baseRevisionId: RevisionId;
	readonly actor: ActorRef;
	readonly operations: readonly [Operation, ...Operation[]];
	readonly preconditions: readonly TransactionPrecondition[];
	readonly metadata: TransactionMetadata;
	readonly createdAt: string;
}
```

`createdAt` 与所有 ID 在可信构造边界注入；reducer 不读取时间。

`createdAt`、Reference `capturedAt`、Evidence `verifiedAt` 和 Revision
`createdAt` 使用唯一 UTC millisecond 形式
`YYYY-MM-DDTHH:mm:ss.sssZ`。Decoder 必须执行真实 calendar validation 和
`Date` ISO round-trip exact check；不接受 offset、缺失 milliseconds、非法日期或
normalize 后才相等的输入。

`TransactionMetadata` 是 closed discriminated union：

```typescript
type TransactionMetadata =
	| {
		readonly source:
			| 'human-input'
			| 'command'
			| 'import'
			| 'migration'
			| 'validator-fix';
	}
	| {
		readonly source: 'proposal-accept';
		readonly proposalId: ProposalId;
		readonly proposalRevision: number;
		readonly proposalChangeGroupId: ProposalChangeGroupId;
	}
	| {
		readonly source: 'undo' | 'redo';
		readonly targetTransactionId: TransactionId;
		readonly targetRevisionId: RevisionId;
	};
```

Metadata 不提供 optional extension bag。Agent session、grant、Tool invocation、
idempotency、Task、model、workflow、debug correlation、UI label 和 transport
identity 不得进入 Transaction。

`TransactionPrecondition` 的 exact union 只有：

```typescript
type TransactionPrecondition =
	| {
		readonly kind: 'document-hash';
		readonly expectedDocumentHash: ContentHash;
	}
	| {
		readonly kind: 'schema-version';
		readonly expectedSchemaVersion: string;
	}
	| {
		readonly kind: 'node-exists';
		readonly nodeId: NodeId;
	}
	| {
		readonly kind: 'node-hash';
		readonly nodeId: NodeId;
		readonly expectedNodeHash: ContentHash;
	}
	| {
		readonly kind: 'entity-exists';
		readonly entityId: EntityId;
	}
	| {
		readonly kind: 'entity-hash';
		readonly entityId: EntityId;
		readonly expectedEntityHash: ContentHash;
	};
```

每个 Transaction 恰有一个 document-hash 和一个 schema-version
precondition。冲突键固定为 `document`、`schema`、`node:<NodeId>` 和
`entity:<EntityId>`；同键重复或使用另一 kind/expected value 都直接拒绝。
Decoder 不排序、不去重、不 normalize，输入顺序原样参与 Transaction hash。

Transaction-level precondition 针对 base Snapshot；Operation expected hash
针对前序 Operation 已生效后的 ordered draft state。

Transaction 的持久 envelope 是 exact
`{ format: 'nireco-transaction', formatVersion: 1, transaction: ... }`，
resource 编码为 canonical manuscript URI string，每个 Operation 使用其完整 V1
持久 envelope；没有旧 `target`、raw Operation、derived hash 或 extension
字段。Transaction hash 针对完整 closed envelope 计算，WAL 直接保存这份
payload。

Operation envelope 自身不重复保存顶层 manuscript resource，因此
`encodePersistedOperationV1` 和 `decodePersistedOperationV1` 都必须接收明确的
expected resource；不存在无 context overload。Transaction codec 把自己的
resource 传入每个 Operation codec，后者用它校验 Claim Anchor 等嵌套资源绑定，
避免同一个 Operation envelope 在另一文稿中被接受。

Strict Transaction codec 在 schema 前以 non-recursive descriptor-safe capture
执行绝对上限：canonical UTF-8 不超过 16 MiB、JSON value 不超过 262,144、
depth 不超过 256、Operation 为 1..1,024、precondition 为 2..4,096。它拒绝
accessor、symbol、non-enumerable field、非 plain prototype、sparse/污染 array、
cycle、非法 Unicode 和 Proxy inspection failure；不调用 caller getter、
iterator 或 `map`，也不把 caller-owned object/array 交给 `JSON.stringify`
或 `structuredClone`。Transaction 内重复
Operation ID 在 codec 边界拒绝，跨历史 Transaction/Operation ID 重用由
model authority 和 recovery used-ID set 拒绝。

模型维护已提交 Transaction ID 和 Operation ID 集合。任何 Transaction 内重复 Operation ID、跨历史重用 Transaction/Operation ID 或 recovery 后重放重复 ID 都显式拒绝；同一个 Operation ID 原样贯穿 compile、hash、WAL、replay 和 Semantic Diff。

原子应用顺序：

```text
decode closed input
→ schema validation
→ acquire per-model serial turn
→ resource and base Revision check
→ reject used Transaction and Operation IDs
→ base Snapshot precondition check
→ apply ordered Operations to private immutable draft
→ step-local node/entity hash validation
→ touched-neighborhood canonical normalization
→ complete schema and academic invariant validation
→ unbound PositionMap and inverse draft generation
→ incremental content hash and Transaction hash
→ final pre-install cancellation check
→ trusted Revision allocation
→ bind Snapshot, PositionMap and inverse plan to Revision
→ encode and verify the complete WAL record
→ install one in-memory commit
→ publish immutable commit event
→ enqueue durability
```

内存 commit 之前的任一步失败都不改变模型、事件、history 或 durability queue。一旦 Revision 安装到内存，取消不回滚该 Revision；`applyTransaction` 返回该 commit，后续 durability wait 可以独立取消。

`PositionMap` 绑定 resource、`fromRevisionId` 和 `toRevisionId`，支持 position、node ID 和 composed mapping。结果只能是 `mapped`、`deleted`、`ambiguous` 或 `orphaned`。Rebase 在显式组合中间 maps 后重新校验 content hash、schema、academic relation 和 scope。

```typescript
type MappingResult<T> =
	| { readonly status: 'mapped'; readonly value: T }
	| { readonly status: 'deleted'; readonly nearest?: T }
	| { readonly status: 'ambiguous'; readonly candidates: readonly [T, ...T[]] }
	| { readonly status: 'orphaned' };

type PositionMapFragment =
	| TextReplaceFragment
	| ChildInsertFragment
	| ChildDeleteFragment
	| ChildMoveFragment
	| TextSplitFragment
	| TextJoinFragment
	| NodeAliasFragment
	| NodeTombstoneFragment;
```

一个 unified PositionMap 由 text replace、node child insert/delete/move、text split/join、normalization alias/tombstone fragments 构成。NodeBoundary child index 和 Text offset 都遵循 `before/after` affinity；split boundary 映射到左末尾或右起点，join 将右 ID 映射到左 ID 并加旧左文本 UTF-16 长度。Compose 同时校验 resource equality 和 Revision 邻接，使用非递归迭代实现，并为 deleted/ambiguous/orphaned 的所有组合冻结 truth table；部分 candidate 失效不能把仍可映射的 candidate 静默降为 orphaned。

`text-replace` 保存 node、`[start,end)` 和 replacement UTF-16 length；`child-insert/delete/move` 保存 parent/index/count 以及受影响 subtree 的完整 Node ID 集合，move destination 使用 source removal 后坐标；`text-split/join` 保存 parent/index、左右 ID 和 split offset 或旧左 length；alias/tombstone 保存 normalization identity 结果。Fragment 非空、closed、深复制并冻结。

Compose 的状态规则固定为：

- `mapped` 继续进入下一 map；
- `deleted` 永久保持 deleted，只有其 nearest 可继续映射；
- `orphaned` 永久保持 orphaned；
- `ambiguous` 展平并稳定去重所有 candidate；全部 candidate 映射到同一值时才能收敛为 mapped，部分 candidate 删除或 orphan 时仍保持 ambiguous，全部删除时成为 deleted，无 surviving candidate 且存在 orphaned 时成为 orphaned。

Normalization 只在所有 ordered Operations 后运行一次，只扫描 touched neighborhoods，不生成 ID。Operation 和 Snapshot codec 已要求 marks canonical；normalization 只验证整组 marks，不排序、不去重、不修复非法的 subscript/superscript 组合。它移除 schema 明确允许移除的空 Text，并合并相邻相同 marks Text（保留左 ID）；输出自己的 PositionMap fragments 和有界 reversible delta，且再次运行必须无变化。复杂度按 touched parent 的直接 child 扫描和 changed ancestor 的 child-slot 浅拷贝计；它不遍历或 rehash unrelated subtree，也不把当前数组结构描述成 persistent vector。

Kernel 产生不含新 ID 的 `InverseDraft`。History boundary 创建 undo Transaction 时分配全新的 Transaction ID 和 Operation ID，并绑定 forward commit 的 Revision 和 post-document hash。Inverse 顺序固定为 normalization inverse，然后从最后一个 forward Operation 到第一个；undo/redo 都是普通的新 Transaction，永不复用 forward Operation ID。

同一模型的 Transaction 串行执行。Reducer 期间不发布可重入事件；listener 发起的新 Transaction 排到下一轮。

## Model Service、Resolver 与生命周期

`IManuscriptModelService` 是活动模型的唯一 registry：

```typescript
interface IManuscriptModelService {
	readonly _serviceBrand: undefined;
	readonly onModelAdded: Event<IManuscriptModel>;
	readonly onModelRemoved: Event<IManuscriptModel>;

	createModel(
		resource: URI,
		initialSnapshot: DocumentSnapshot,
		options: ICreateManuscriptModelOptions,
	): IManuscriptModel;
	getModel(resource: URI): IManuscriptModel | null;
	getModels(): readonly IManuscriptModel[];
	destroyModel(resource: URI): void;
}
```

模型表以 `getComparisonKey(resource)` 为 key。重复 create 抛出 `MANUSCRIPT_MODEL_ALREADY_EXISTS`；不存在的 destroy 不伪造成功事件。模型 dispose 会从 service 移除活动实例，但不会删除持久资源。

`IManuscriptModelResolverService` 负责资源解析和引用生命周期：

```typescript
interface IManuscriptModelReference extends IDisposable {
	readonly model: IManuscriptModel;
}

interface IManuscriptModelResolverService {
	readonly _serviceBrand: undefined;
	createModelReference(
		resource: URI,
		token: CancellationToken,
	): Promise<IManuscriptModelReference>;
	registerContentProvider(
		scheme: string,
		provider: IManuscriptModelContentProvider,
	): IDisposable;
}
```

Comet 当前没有通用 `IReference<T>` / `ReferenceCollection` 基座；Editor
因此只定义上述领域 reference，不新建一套通用引用框架，也不复制上游的
reference collection。Reference 的唯一可观察值是模型本身，引用计数和
retention bookkeeping 留在 resolver 私有实现。

Resolver 首先复用现有活动模型；不存在时只调用精确 scheme provider。Provider 返回受校验的 Snapshot 或 typed failure，不返回 `null` 表示“尝试其他路径”。最后一个 reference 释放后，resolver 可以按明确 retention policy 卸载模型。

`DraftEditorInput.resolve()` 持有 model reference。Input 只拥有资源、标题、dirty/save/revert contract 和引用生命周期，不保存 canonical document、Selection 或第二套 history。每个 `DraftEditorPane` 持有自己的 Selection 和 ViewState。

关闭 Pane 只销毁 View。关闭最后一个 Input reference 可以卸载活动模型，但不会删除文档。删除持久文档是另一个带权限和审计的显式操作。

## Revision 与历史

主分支使用严格线性 Revision：

```typescript
interface Revision {
	readonly id: RevisionId;
	readonly resource: URI;
	readonly parentRevisionId: RevisionId | null;
	readonly transactionId: TransactionId;
	readonly sequence: number;
	readonly documentHash: ContentHash;
	readonly actor: ActorRef;
	readonly createdAt: string;
}
```

Revision immutable，ID 不等于 content hash。相同内容可以产生不同 Revision。顺序由唯一 authority 的 `sequence` 和 parent 决定，不依赖墙上时间。主分支不会因 undo、rebase 或 compaction 被重写。

Undo/redo 提交 inverse Transaction 并产生新 Revision；它不删除历史。多个 View 共享文档历史，Selection 恢复数据留在各自 View history metadata。Browser View 不维护第二套文档 undo/redo stack。

## Authority 与 durability

每个 manuscript resource 在任一时刻只有一个可写 authority。Authority 串行分配 Revision，持有 Platform storage fence，并在每次持久写前验证 generation/fence。Base mismatch、stale fence、sequence gap 或 parent mismatch 都 fail closed。

Durability level：

```typescript
type DurabilityLevel = 'memory' | 'wal' | 'snapshot';
```

- `memory`：Revision 已安装到唯一活动模型。
- `wal`：对应 WAL record 已完整 append 且 fsync 成功。
- `snapshot`：包含该 Revision 的 Snapshot 已写入临时对象、校验，并通过 atomic manifest switch 成为 current generation。

`applyTransaction()` 成功只承诺 `memory`。需要可靠保存的调用方使用 `whenDurable(revisionId, 'wal' | 'snapshot', token)`。等待取消只取消该 waiter，不改变 Revision 或 storage queue。

### WAL 顺序

WAL 按 Revision sequence 严格串行：

```text
encode closed record
→ append complete length/checksum record
→ fsync
→ mark Revision wal
→ resolve wal waiters
```

在前一 Revision 达到 `wal` 前，不得把后一 Revision标记为 `wal`。WAL record 包含 format version、sequence、parent Revision、Transaction hash、Document hash 和 checksum。

### 故障语义

| 故障点 | 模型状态 | waiter 结果 | 后续写入 |
|---|---|---|---|
| commit 前验证、base 或 precondition 失败 | 原状态 | Transaction typed error | 允许 |
| memory commit 前取消 | 原状态 | `CancellationError` | 允许 |
| memory commit 后取消 | Revision 保留 | commit 仍返回；独立 waiter 可取消 | 允许 |
| WAL record encode 失败，尚未 memory commit | 原状态 | Transaction typed error | 允许 |
| WAL append 或 fsync 失败 | `durability-fault`、read-only | 该 Revision 及所有非-memory waiter 失败 | 拒绝 |
| writer fence 或 generation 失效 | `authority-lost`、read-only | 所有未完成非-memory waiter 失败 | 拒绝 |
| Snapshot 临时写、校验或 manifest switch 失败，而 WAL 有效 | 保持 writable；记录 snapshot failure | 对应 snapshot waiter 失败 | 允许，Snapshot 可显式重试 |
| WAL 中间损坏、hash mismatch、sequence gap 或 parent mismatch | `recovery-required`、read-only | 打开或恢复失败 | 拒绝 |
| WAL 尾部不完整且最后完整边界有效 | 恢复到最后完整 record | 返回恢复诊断 | fence 校验后允许 |

WAL append/fsync failure 对当前活动 authority 是终态；失败 Revision 与其后所有排队的 memory suffix 都不得宣称 `wal`，相关非-memory waiter 全部失败。Authority 不原地重试并继续接受新 Transaction。恢复需要关闭当前 writer，通过显式 recovery 重新验证 Snapshot、WAL、generation 和 authority fence 后创建新的活动模型。已提交的 memory suffix 不会被替换为空文档、静默回滚或在 dispose 时假装保存。

普通 Snapshot failure 不使已有 WAL durable Revision 失效。失败的临时 Snapshot 是 orphan，不更新 manifest，也不触发 WAL truncate。只有 atomic manifest switch 完成后才能声明 `snapshot`，只有新 Snapshot 覆盖的 WAL 范围在同一有效 fence 下才能被条件截断。

`savedRevisionId` 只在目标 Revision 达到 Input 配置的 durability level 后更新。保存失败保持 dirty；Workbench 关闭流程不得静默丢弃 memory-only 或 durability-fault 内容。

### Platform durable storage

`IStorageService` 是应用设置 key/value store，不能承诺 WAL、fsync、fencing 或 atomic Snapshot。`src/cs/platform/storage/common/durableStorage.ts` 提供与 Editor 无关的 byte primitive，其实现必须支持：

- 按 resource 打开 fenced writer，并返回不可伪造的 generation/fence；
- durable append 与显式 sync；
- bounded range read 和 durable length；
- 临时对象写入与校验后的 immutable atomic install；object key 绑定唯一
  Revision/content identity，已存在 key 必须 conflict，不能在 manifest CAS 前覆盖；
- immutable object descriptor 可按 key 恢复，byte read 必须匹配 descriptor
  generation；manifest 精确保存 object key 与 object generation，响应丢失后的 retry
  不能生成第二份 current identity；
- compare-and-swap generation/manifest；
- 只在匹配 fence/generation 时执行 tail truncate；
- 区分 unsupported、permission、space、corruption、fence-lost 和 I/O failure；
- 实现无法提供承诺时显式拒绝，而不是降级到普通 key/value 或无锁文件写入。

Editor common 拥有 WAL/Snapshot/manifest 的领域 codec、hash 验证、replay 和 recovery；Platform 只处理 opaque bytes、原子性和 durable ordering，不导入 Editor 类型。

显式 `flush()` 和 application shutdown coordination 负责等待 durability。`dispose()` 只释放内存资源，不能返回 Promise 或隐式承诺 flush。

## Proposal 与 Semantic Diff

Proposal 是与主分支分离的结构化修改集合：

```typescript
interface Proposal {
	readonly id: ProposalId;
	readonly resource: URI;
	readonly baseRevisionId: RevisionId;
	readonly proposalRevision: number;
	readonly actor: ActorRef;
	readonly status: ProposalStatus;
	readonly semanticEdits: readonly SemanticEdit[];
	readonly validation: ProposalValidationSnapshot;
	readonly diff?: SemanticDiff;
	readonly provenance: ProposalProvenance;
}
```

Proposal 使用独立、单调的 `proposalRevision` 做乐观并发。所有 mutation 携带 expected proposal revision。`needs-review` 后内容冻结；Agent 不能 reopen、accept、reject 或 commit。

合法主状态：

```text
draft → validating → validated → needs-review
validating/validated → conflicted
needs-review → accepted | partially-accepted | rejected | conflicted
non-terminal → discarded | expired
conflicted → draft | discarded
```

终态 Proposal 不原地修改。Rebase 产生新 Proposal Revision、更新 base Revision、重新验证所有 target/hash/academic/scope 约束并重新生成 Semantic Diff。

Agent 和产品功能提交的是高层 `SemanticEdit`，不是 raw Operation。Proposal compiler：

```text
closed input decode
→ target and scope validation
→ clientRef to trusted ID allocation
→ schema and academic validation
→ persistent Operation allocation
→ compile deterministic Transaction draft
→ Proposal Revision
→ Semantic Diff
```

Semantic Diff 是可持久、可重复计算的领域结果，不是字符 UI diff。它表达结构变化、Citation/Evidence/Claim 变化、依赖闭包、warnings 和生成目标 Revision。Character diff 只是绑定 Group 和 Revision 的派生显示。

部分接受由 Workbench 用户 review controller 发起。Editor Proposal Service 只计算依赖闭包、验证选中集合并编译一个原子 Transaction；用户 actor 和当前 head 由受信 Workbench 边界注入。Agent Tool executor 没有这条调用能力。

## 浏览器 Editor

Browser Editor 是 Editor-owned model/view/controller 管线，不使用 ProseMirror、contenteditable 文档模型或第三方 step/history authority：

```text
DocumentSnapshot
→ revision-bound ViewModel
→ view parts / read-only DOM projection
→ Editor-owned text input surface
→ typed command / semantic Operation compilation
→ revision-bound Editor Transaction
→ IManuscriptModel commit
→ PositionMap-driven ViewModel update in every attached View
```

`browser/view` 从 Snapshot 构建 revision-bound `ViewModel`，按稳定 Node ID 生成 view parts，并只 patch 受影响的 DOM 区域。渲染 DOM 是只读投影，不通过 MutationObserver、DOM 顺序或 `innerHTML` 反推正文。结构、marks、原子 inline node 和学术实体的合法性只由 common schema 与 transaction kernel 决定。

每个 View 拥有一个 Editor-controlled text input surface，用于键盘、IME、clipboard 和 accessibility 输入；正文渲染树不是 browser editing host。Pointer hit testing、键盘导航和 DOM Selection projection 映射为 `SemanticPosition`。Controller 只从当前 View base Revision 编译 typed command/Operation；只有模型 commit 成功后才更新 authoritative projection。外部 commit 通过 PositionMap 更新每个 View 的 ViewModel 和 Selection。

禁止：

- ProseMirror package、schema、state、view、step、plugin 或 history；
- `contenteditable`/`execCommand` 作为正文编辑或 history authority；
- browser-local 文档 undo stack；
- 将整份 DOM 或 browser-local JSON 回写到 `DraftEditorInput`；
- prop-echo `sync.ts` 形成双向正文 authority；
- `Math.random`、短 ID 或 DOM 顺序作为 node identity；
- MutationObserver 把任意 DOM mutation 当成正文；
- invalid-to-empty、unsupported-to-text 或 stale-revision retry fallback。

Composition 是显式 View 状态。composition buffer 只属于当前 View，并作为 decoration 投影；一次 composition 对应一个 Transaction 和一个 undo group。模型发生外部 commit 时，View 通过 PositionMap 延迟或映射 composition；无法安全映射时取消 composition、恢复模型投影并报告 typed diagnostic。

`beforeinput` 至少覆盖 insert text/composition/paragraph/line break、grapheme-aware delete、paste/cut/drop、history undo/redo 和 formatting command。Clipboard HTML 先 sanitize、parse、schema adaptation 和 validation，再构造一个原子 Transaction；不直接插入 DOM。

多个 View 连接同一模型时：

- 正文和 history 共享；
- Selection、focus、scroll、composition 和 ViewState 独立；
- 一个 View dispose 不销毁模型或其他 View；
- 一个 View 的 commit 通过同一模型事件更新其他 View；
- Selection mapping 失败显式进入失焦或需用户重新定位状态，不猜测位置。

## Revision-bound read 与 Agent 边界

Editor common 提供确定性的 revision-bound read、outline、search、history、diagnostics 和 proposal service。每个调用显式接收 resource、Revision、query/target、limit 和 `CancellationToken`，每个结果显式返回 `basedOnRevisionId`。

Editor read service 可以返回领域 continuation value，但不拥有 Agent session、grant、expiry、policy、query hash、idempotency record 或 opaque cursor。这些属于 `src/cs/workbench/contrib/draftEditor`：

```text
Agent Task / canonical Tool call
→ Workbench draftEditor executor
→ validate session, grant, scope, target and budget
→ resolve exact IManuscriptModel Revision
→ call Editor read/proposal service
→ bind continuation into an opaque Workbench cursor
→ return canonical Tool result
```

Workbench cursor 绑定 session、resource、Revision、scope、query digest 和 expiry。Editor 不解析它。Tool call ID、session ID、capability grant ID 和 Agent task ID 也不进入 Editor identifiers。

Platform Agent Host 只看到通用 Tool descriptor、interaction target、content resource、call、result、cancellation 和 executor connection。它不导入 Editor、Draft Editor、Proposal 或 Manuscript 类型。Feature-owned Workbench code完成 Editor 类型与 canonical Tool schema之间的直接映射，不增加 Nireco adapter。

进程内 TypeScript Editor contract 是事实来源。不存在独立 Contract Bundle、package manifest、generated Nireco types、handshake、capability matrix、Preview protocol、Mock Service、tarball consumer 或跨仓 compatibility path。真正跨进程的 generic Agent Host 和 durable storage 边界使用其拥有层的 versioned codec。

### Agent 权限

Agent 可用能力由 Workbench Tool registry 和受信 Task policy决定。无论模型输入如何，Agent 都不能获得：

```text
document.commit
document.apply_raw_transaction
document.storage.write
document.schema.mutate
review.accept
review.commit
```

所有 mutating Agent Tool 只修改 Draft Proposal。Tool input 中的 resource、Revision、Proposal revision、session、grant、policy 和 idempotency metadata 由受信 executor 注入或核对；模型提供的同名字段不能覆盖它们。

## 学术图与 Source 所有权

Manuscript 模型拥有：

- 文稿中的 Citation node；
- 可重复渲染的 Reference Snapshot；
- Claim、Evidence Link 和关系；
- CrossReference；
- 文稿内 Figure、Table、Equation 和附件引用；
- Proposal 中的学术变化与 provenance。

Comet Source/PDF/Web Feature 拥有：

- PDF、网页、数据集和项目文献库全文；
- retrieval、extraction、index 和访问控制；
- source content version；
- Evidence 候选与来源定位。

Editor 保存验证 Citation 所需的最小 Reference Snapshot、source `URI`、content hash、locator 和允许落盘的 excerpt snapshot，不接管 Source 全文。Source hash 变化会使关联 Evidence stale。`verified` 只表示来源身份、版本、locator 和 excerpt 可追溯，不表示学术结论为真。

## Diagnostics、错误与安全

派生 Outline、Bibliography、numbering、search index、diagnostics、character diff 和 render cache 都绑定 Revision，可删除并重建。不同 Revision 的结果不得被拼成一个结果而不显式报告 stale 或重新计算。

稳定模型错误至少覆盖：

```text
MANUSCRIPT_MODEL_ALREADY_EXISTS
MANUSCRIPT_MODEL_NOT_FOUND
MANUSCRIPT_RESOURCE_UNSUPPORTED
MANUSCRIPT_REVISION_NOT_FOUND
MANUSCRIPT_BASE_REVISION_MISMATCH
MANUSCRIPT_TRANSACTION_INVALID
MANUSCRIPT_SCHEMA_INVALID
MANUSCRIPT_HASH_MISMATCH
MANUSCRIPT_AUTHORITY_LOST
MANUSCRIPT_DURABILITY_FAILED
MANUSCRIPT_RECOVERY_REQUIRED
MANUSCRIPT_WRITE_SUSPENDED
MANUSCRIPT_PROPOSAL_REVISION_MISMATCH
MANUSCRIPT_PROPOSAL_LOCKED
```

错误携带 stable code、safe structured data 和必要的 current Revision/conflict targets，不把本地化文本当控制协议。Workbench 负责将 Editor error 映射到用户 UI 或 Tool result。

Snapshot、WAL、clipboard、import、Agent input、Source metadata 和 URI payload 都是不可信输入。Decoder 只接受 closed plain data，先检查绝对资源上限，再检查 schema 和领域预算。拒绝 getter、Proxy inspection failure、prototype pollution、超深结构、非法 Unicode、sparse array、非 canonical ID 和越界 offset。

正文、Source 和 Tool result 中的指令文字只作为数据，不改变 Agent policy 或 capability。日志默认只记录 ID、hash、状态和脱敏摘要，不记录完整正文、Prompt、Evidence excerpt 或 credential。

## 性能档位

唯一规模定义位于 `src/cs/editor/test/common/performance/manuscriptProfiles.ts`。S 是交互基线，M 是完整目标文稿，L 是压力文稿。规范、fixture generator、benchmark 和报告都导入或读取同一份 profile，不在 package metadata、manifest 或另一份文档重复锁定数值。

性能约束：

- S/M 局部输入到已提交模型和受影响 DOM patch 的 P95 目标小于 16 ms；
- 局部 Transaction 不默认 clone、serialize、hash 或 render 整棵树；
- canonical JSON、hash、PositionMap 和 index update 不产生与无关文档大小成正比的重复工作；
- Outline、search、diagnostics 和 Proposal validation 使用 revision-bound incremental index；
- 大读取显式分页并报告 approximate bytes 和 truncation；
- L profile 可以异步完成非输入关键派生工作，但结果必须标明 Revision 和 stale 状态。

首次 Snapshot strict decode 和独立 hash rebuild 是
`O(W × structuralItems + metadataItems + canonical content bytes)`，其中
formal key width `W` 对 node/entity 固定为 32、对 relation 固定为 64，因此
相对 item count 仍为线性。Structural lookup/replace/insert/remove 最多访问
32 或 64 个 Patricia nibble 层，每层 branching 最大为 16；这是 fixed-width
bound，不表述为 `O(log32 N)`。Move 是有界 remove+insert，只更新常数个
linked entry/path。Metadata 同长单项 replacement 才使用 fanout-32 positional
path update；结构改变或完整 replacement 按实际 positional rebuild 计。

当前 Snapshot 的正文、Academic Graph collection 和 metadata 使用 immutable
array；parent children、collection 或 metadata array 的浅拷贝仍可能对对应
array length 线性，绝不能算作 Patricia 对数更新。Full rebuild 的性能证据
分别报告 structural item reads、Patricia visits/copies 和 hash calls；
wall-clock 只与这些结构证据及 raw samples 一起解释。

性能结论只来自被测 Comet commit、真实 Model Service、真实 projection、固定 reference environment、raw samples 和 profile identity。

## 验证

### 测试位置

| 证据 | 最终位置与宿主 |
|---|---|
| core/model/service unit | `src/cs/editor/test/common/**`，Node host |
| Editor browser core 与 contribution 跨 runtime 证据 | `src/cs/editor/test/browser/**`，真实 Browser host；feature-local 测试不能替代该中央镜像 |
| Workbench Draft/Tool integration | `src/cs/workbench/contrib/draftEditor/test/**`，其真实所属 host |
| desktop durable storage/IPC | `test/unit/electron/editor/**`，真实 Electron host |
| platform durable byte store | `src/cs/platform/storage/test/**`，对应真实实现 host |

JSDOM 可以测试纯 DOM helper，但不能作为 IME、Selection、beforeinput、clipboard、composition 或多 View 浏览器证据。

### 必须证明的行为

- canonical JSON、portable SHA-256、positional Merkle 和 structural Merkle
  exact payload golden 在 Browser 与 Node oracle 一致；真实 Browser 证据位于
  `src/cs/editor/test/browser/**`；
- structural empty/singleton、32/64 nibble、long prefix、last nibble、
  split/merge、order sensitivity、move-back 和 history convergence；
- 20k structural full rebuild 证明每项只读取一次，且 fixed-width Patricia
  visits/copies/hash calls 有界；
- incremental Merkle root 必须与每个新 Snapshot 的独立完整复算逐 Revision
  完全一致，且局部编辑的 visits/copies/hash calls 只覆盖 changed paths；
- UUIDv7 parser/allocator、clock rollback、sequence exhaustion、UUIDv8 derivation和 Change Group exact payload；
- Operation ID 在 compile、hash、WAL、replay 和 diff 中保持同一身份；
- Transaction atomicity、inverse、PositionMap compose、normalization 和 deterministic replay；
- 同 resource 单活动模型、reference lifetime、重复 provider 和 unsupported resource 失败；
- WAL 每个 append/fsync/fence 故障点的 terminal state和 waiter 结果；
- Snapshot temporary write、verify、manifest switch、orphan、retry和 conditional truncate；
- 完整 WAL、尾部截断、中间损坏、hash mismatch、sequence gap和 parent mismatch recovery；
- Proposal state machine、rebase、Change Group identity、dependency closure和 Agent proposal-only；
- Editor-owned browser pipeline 无第二 authority、无 browser-local history、无随机 ID，两个 View 共享模型并独立 Selection；
- 中文/日文/韩文 IME、Emoji、grapheme delete、paste、split/join、marks、list、figure、citation和 undo/redo；
- Draft Editor Tool endpoint直接调用 Editor service，Platform Agent Host不导入 Editor/Workbench；
- S/M/L profile identity和性能预算不漂移。

### 仓库验证入口

```text
npm run test:unit -- --runtime node --run <focused-test>
npm run test:unit -- --runtime browser --glob "src/cs/editor/test/browser/**/*.test.ts"
npm run test:unit -- --runtime electron --glob "test/unit/electron/editor/**/*.test.ts"
npm run typecheck:tests
npm run test:coverage
npm run valid-layers-check
npm run build
npm run verify
```

Focused test 只用于迭代；完成阶段必须运行所有受影响 runtime、typecheck、coverage、layer check 和 repository verification。

## 完成态

完整的数据流只有一条：

```text
DraftEditorInput resource
→ resolver-owned IManuscriptModel reference
→ browser View projects immutable Snapshot
→ human input or accepted Proposal creates Transaction
→ model installs one Revision
→ WAL then Snapshot advance durability
→ all Views project the same model

Agent Tool
→ Workbench draftEditor validates target/grant/scope
→ Editor revision-bound read or Proposal service
→ user review in Workbench
→ accepted groups compile one Transaction
→ same model and durability path
```

没有外部 Nireco package、adapter、compatibility module、独立 contract、第二 URI 系统、第二 document authority、第二 undo stack、raw Agent write path 或 persistence fallback。
