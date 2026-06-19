# Repository TypeScript Naming And Type Style

这份文档是本仓库的 TypeScript 类型与命名约定。

它参考现代 TypeScript 社区常见实践，但不声称是某个上游项目或官方规范的直接照搬。

目标只有两个：

- 让类型写法一致。
- 让命名在保留语义的前提下不过度膨胀。

## 默认规则

- 默认使用 `type`。
- 只有在表达“类要实现的对象契约”时，才优先使用 `interface`。
- 只在类型位置使用的导入，默认显式写 `import type` 或内联 `type` 标记。

这样做的原因很直接：

- `type` 覆盖面更大，能统一处理对象、联合、交叉、索引访问、工具类型结果。
- `interface` 保留给少数真正强调“接口语义”的场景，可读性更清楚。
- 显式的类型导入能区分运行时值和编译期类型，降低阅读和工具链歧义。

## 什么时候用 `type`

以下情况一律使用 `type`：

- 联合类型。
- 字面量别名。
- 交叉类型。
- `Omit`、`Pick`、`NonNullable`、`ReturnType` 等工具类型结果。
- `Foo['bar']` 这类索引访问类型。
- 组件 `props`、配置对象、临时结构对象。
- 只是在给已有类型起别名，没有额外接口语义时。

示例：

```ts
export type ActionBarOrientation = 'horizontal' | 'vertical';

export type BadgeProps = {
  icon?: LxIconName;
  label?: string;
};

type ActionViewMode = NonNullable<ActionBarActionItem['mode']>;
```

## 什么时候用 `interface`

以下情况可以使用 `interface`：

- 某个类型的核心职责就是表达 class contract。
- 该类型会被 `implements`，并且保留 `interface` 能让语义更直接。
- 该类型是少数稳定、长期存在的公共对象契约，团队明确希望把它视为“接口”。

示例：

```ts
export interface IActionViewItem {
  render(container?: HTMLElement): void;
  getElement(): HTMLElement;
  dispose(): void;
}

export abstract class BaseActionViewItem implements IActionViewItem {
  // ...
}
```

## 类型导入

只在类型位置使用的符号，默认显式标记为类型导入。

推荐写法：

```ts
import type { HoverService } from './hover';

import {
  ActionViewItem,
  BaseActionViewItem,
  type ActionViewItemOptions,
} from './actionViewItems';
```

不推荐在纯类型导入上省略 `type`：

```ts
import { HoverService } from './hover';
```

### 什么时候写 `type`

以下情况默认写 `type`：

- 这个导入只出现在注解、泛型、返回类型、参数类型、工具类型中。
- 这个导入没有任何运行时读取、实例化、继承或调用行为。

### 什么时候不写 `type`

以下情况不要写 `type`：

- 需要在运行时读取这个符号。
- 需要 `new` 它。
- 需要 `extends` / `instanceof` / 静态属性访问。
- 它本身就是函数、类、常量、枚举或其他运行时值。

例如：

```ts
import { ActionViewItem } from './actionViewItems';
import { type ActionViewItemOptions } from './actionViewItems';

const item = new ActionViewItem(...);
```

### 说明

- `type` 导入不是语法层面的强制要求，但它是本仓库推荐的现代写法。
- 目标不是追求形式统一，而是明确区分“运行时值”和“编译期类型”。

## 不推荐的写法

- 不要为了“对象类型都该用 interface”而机械改写。
- 不要保留没有实际语义价值的空壳继承接口。
- 不要在同一模块里同时使用 `type Foo = {}` 和 `interface Bar {}` 表达同一层级的普通配置对象，除非有明确理由。

例如下面这种，默认不保留：

```ts
export interface IBaseActionViewItemOptions {
  hoverService?: HoverService;
}

export interface IActionViewItemOptions extends IBaseActionViewItemOptions {}
```

如果只是配置对象占位，没有 `implements` 语义，改成：

```ts
export type ActionViewItemOptions = {
  hoverService?: HoverService;
};
```

## 命名约定

- `type` 默认不用 `I` 前缀。
- `interface` 也不强制使用 `I` 前缀。
- 新增类型命名不要编码声明形式，不因为它是 `interface` 就命名成 `IHoverDelegate`、`IActionOptions` 这类名字。
- 新增代码统一优先使用业务语义命名，例如 `HoverDelegate`、`ActionViewItemOptions`、`TitlebarActionItem`。
- 历史上已经稳定存在、且明显表示接口契约的 `I*` 命名可以保留，但不继续扩散。
- 新增代码优先使用不带 `I` 的业务命名；如果某个 `interface` 已经被广泛引用，不为了风格统一单独重命名。

示例：

```ts
// preferred
export interface HoverDelegate {
  show(): void;
}

// avoid for new code
export interface IHoverDelegate {
  show(): void;
}
```

## 职责命名约定

类型命名优先表达职责，不表达“它是用 `type` 还是 `interface` 声明的”。

常用后缀按下面理解：

- `Props`：组件、view、函数的输入参数。
- `Options`：创建时或初始化时传入的配置。
- `State`：状态快照或运行时状态结构。
- `Service`：长期存在、主动提供能力的对象。
- `Provider`：按需提供数据、值或实例的对象。
- `Controller`：负责驱动流程、状态切换或生命周期的对象。
- `Delegate`：主流程由别处控制，这个对象只负责提供回调决策。

### `Delegate` 的使用边界

`Delegate` 不是默认推荐后缀，只在语义明确匹配时使用。

满足以下条件时，才考虑使用 `Delegate`：

- 有一个主控方掌握流程或生命周期。
- 主控方会在运行过程中回调这个对象。
- 这个对象的职责是回答“如何处理”“如何决策”“如何提供局部行为”。

典型例子：

- `ContextMenuDelegate`
- `HoverDelegate`
- `TreeNodeDelegate`

以下情况不要使用 `Delegate`：

- 普通配置对象。
- 普通数据结构。
- 长期提供能力的对象。
- 驱动状态和生命周期的主控对象。
- 只是因为“不知道该叫什么”而临时起名成 `Delegate`。

对应应当优先考虑：

- 配置输入用 `Props` / `Options`
- 状态结构用 `State`
- 长期能力对象用 `Service` / `Provider`
- 主控对象用 `Controller`

一句落地规则：

- 非典型委托场景，不使用 `Delegate` 命名。

## 契约与实现

本仓库采用现代 TypeScript 约定，不把 `I*` 当作默认方案。

目标是两件事同时成立：

- 调用方尽量依赖契约，而不是依赖具体实现。
- 契约名和实现名靠职责区分，而不是靠 `I` 前缀区分。

推荐规则：

- 契约使用语义核心名。
- 具体实现显式带实现语义，如 `Base`、`Default`、`Dom`、`Store`、`Controller`。
- 调用层、业务层优先 `import type` 契约。
- 装配层、实现层可以同时引入契约和实现，但命名必须能看出角色差异。

例如：

```ts
type HoverDelegate = { ... };
class DomHoverDelegate implements HoverDelegate { ... }

interface ActionViewItem { ... }
abstract class BaseActionViewItem implements ActionViewItem { ... }
class DefaultActionViewItem extends BaseActionViewItem { ... }
```

### 是否应该只 import 一个契约

不是全局硬规则，但它是一个好的默认方向。

可以优先只依赖契约的场景：

- 业务层。
- 调用层。
- 通过工厂、注册表或参数注入获取实例的模块。

不能机械要求只 import 一个契约的场景：

- 当前模块本身就是实现层。
- 当前模块需要 `new` 某个默认实现。
- 当前模块需要基类做 `instanceof`、继承或共享行为复用。

一句落地规则：

- 消费层尽量只依赖契约；实现层按需依赖实现。
- 如果一个文件同时 import 多个相近名字，优先检查职责命名是否足够清楚，而不是强行减少 import 数量。

## 控制命名长度

本仓库鼓励语义化命名，但不鼓励把每一层上下文都堆进同一个名字里。

命名的目标不是“把所有信息塞进一个标识符”，而是“在当前模块上下文里足够清楚”。

优先遵守下面几条：

- 名字只表达当前层级真正缺少的信息。
- 已经被文件名、模块名、类名表达过的上下文，不在局部类型名里重复。
- 避免连续堆叠 3 个以上名词修饰。
- 避免 `ActionBarDropdownMenuActionViewItemOptions` 这类把调用链直接拼进类型名的写法。
- 如果一个名字必须靠很多后缀才能说清，通常说明职责还没拆开。

### 推荐缩短方式

- 先去掉模块前缀。
  - 在 `dropdownActionViewItem.ts` 里，优先 `MenuActionOptions`
  - 不优先 `DropdownMenuActionViewItemOptions`
- 再去掉实现细节词。
  - 优先 `MenuActionItem`
  - 不优先 `MenuActionViewItem`，除非仓库里确实需要和 model/controller 区分
- 只保留一个职责后缀。
  - `Props`、`Options`、`State`、`Controller` 选一个即可
  - 避免 `ItemOptionsConfig`、`ViewControllerManager` 这种双重后缀
- 优先依赖局部上下文，而不是全局唯一长名。
  - 文件里已经是 titlebar 语境时，优先 `ActionItem`
  - 对外导出且跨模块使用时，再补成 `TitlebarActionItem`

### 判断规则

看到一个名字时，问下面两个问题：

- 去掉一个前缀后，在当前文件里还会不会歧义？
- 去掉一个后缀后，职责是否仍然清楚？

如果两个答案都是“不会”，那这个词大概率多余。

### 建议的长度控制

- 类型名通常控制在 2 到 4 个语义词。
- 超过 4 个语义词时，默认先考虑改名。
- 超过 5 个语义词时，默认先考虑拆职责，而不是继续加词。

这不是硬性字符数限制，而是可读性预警线。

### 例子

优先：

```ts
type HoverDelegate = { ... };
type ActionItem = { ... };
type TitlebarActionItem = { ... };
type MenuActionOptions = { ... };
```

避免：

```ts
type IHoverDelegate = { ... };
type TitlebarIconActionItemOptions = { ... };
type DropdownMenuActionViewItemOptions = { ... };
type ActionWithDropdownActionViewItemOptions = { ... };
```

## 迁移原则

- 旧代码不因为纯风格原因大面积改动。
- 只在以下时机顺手整理：
  - 当前文件正在被功能修改。
  - 某段类型声明明显造成理解成本。
  - 同一模块内混用方式已经影响可读性。
- 风格整理时优先保证 API 稳定，避免无意义重命名扩散。

## 针对当前仓库的落地规则

- UI 基础组件里的 `Props`、`Options`、状态对象，默认使用 `type`。
- 联合类型、别名、工具类型结果，一律使用 `type`。
- 少数 view/model contract，如果 class 会直接 `implements`，可以保留 `interface`。
- 空壳 `extends` 接口不新增；已有代码如无必要不扩散。
