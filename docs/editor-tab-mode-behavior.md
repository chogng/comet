# Editor Tab Mode Behavior

## 结论

顶部始终保留三个可直接使用的常驻 tab。

当前应该按下面这套产品语义理解：

1. 顶部始终有三个常驻 tab
   `draft` / `browser` / `pdf`
2. 这三个常驻 tab 本身就是可直接进入和使用的 tab
3. 它们不是“点击后再创建一个新的 `New Tab`”的入口
4. 在这三个常驻 tab 之外，还可以继续创建额外的同类型 tab

也就是说：

1. 常驻 tab 是 tab
2. 后续新建出来的 tab 也是 tab
3. 真正需要区分的重点不是“是不是入口”，而是：
   常驻 tab 还是后续新建 tab
4. 以及：
   当前是空态还是非空态

## 当前目标模型

长期更合适的模型是：

1. `kind`
   `draft` / `browser` / `pdf`
2. `residency`
   `resident` / `dynamic`
3. `contentState`
   `empty` / `resolved`

这里的含义是：

1. 三个常驻 tab 永远保留
2. dynamic tab 是用户后续新建出来的工作 tab
3. resident 和 dynamic 都还是同一类 tab，只是展示和默认行为不同

## Tab 语义

### Resident tab

resident tab 指顶部始终保留的三个常驻 tab。

它们的职责是：

1. 作为三种 mode 的稳定锚点
2. 可以被直接激活和直接使用
3. 当该 kind 当前没有额外工作 tab 时，仍然保留一个可进入的常驻位置

### Dynamic tab

dynamic tab 指用户后续显式新建出来的 tab。

它们和 resident tab 的区别不在于 kind，而在于：

1. 它们不是常驻位
2. 可以继续增加数量
3. 空态展示规则不同

## 空态和标题

当前最重要的问题已经缩小到：

1. 空态怎么定义
2. 空态 label 怎么显示

### Empty resident tab

常驻 tab 处于空态时，不显示 label，只显示 icon。

这条规则的含义是：

1. 常驻 tab 自己就是 mode 锚点
2. 它不需要再用 `New Tab` 去提示“我刚被创建”
3. 它空态时应该尽量安静

### Empty dynamic tab

动态新建出来的 tab 只要还是空态，就显示 `New Tab`。

这条规则的含义是：

1. 它已经不是常驻锚点
2. 它是一个真正新开出来、但还没填内容的工作 tab
3. `New Tab` 正好用来表达这个状态

### Resolved tab

无论 resident 还是 dynamic，只要进入非空态，就显示真实标题。

如果已经不是空态，但真实标题暂时还拿不到，可以回退到类型默认名：

1. `Draft`
2. `Source`
3. `PDF`

## 当前空态定义

当前可先按下面理解：

1. `draft`
   标题为空，正文纯文本为空
2. `browser`
   `url === 'about:blank'`
3. `pdf`
   `url === 'about:blank'`

现在三种类型都已经可以拥有稳定的真实空态 tab。

## 拖拽和排序

这里要区分两个层面：

1. resident tab 的锚点价值
2. dynamic tab 的工作流排序价值

当前更适合的原则是：

1. resident tab 作为稳定锚点存在
2. dynamic tab 允许排序
3. 具体是否允许 resident 参与拖拽，不应再被解释成“它不是 tab”

也就是说，resident 是否拖拽是交互策略问题，不是对象类型问题。

## 当前实现说明

当前实现会为缺失的 mode 渲染常驻空位，用来保持三个常驻 tab 始终存在：

1. `editorGroupModel` 负责为缺失 mode 生成 resident entry
2. `tabsTitleControl` 负责把无 `targetTabId` 的 resident entry 当作可直接进入的 tab
3. 点击这类 resident entry 会走 `onOpenPaneMode(...)`

相关代码：

1. [`src/ls/workbench/browser/parts/editor/editorGroupModel.ts`](/Users/lance/Desktop/Literature-Studio/src/ls/workbench/browser/parts/editor/editorGroupModel.ts)
2. [`src/ls/workbench/browser/parts/editor/tabsTitleControl.ts`](/Users/lance/Desktop/Literature-Studio/src/ls/workbench/browser/parts/editor/tabsTitleControl.ts)
3. [`src/ls/workbench/browser/parts/editor/editorGroupView.ts`](/Users/lance/Desktop/Literature-Studio/src/ls/workbench/browser/parts/editor/editorGroupView.ts)

这里要特别强调：

“点击 resident tab” 的语义应该是“直接使用这个 tab”，而不是“创建一个新的 `New Tab`”。

## 当前方向

本轮修正后的方向应该是：

1. 保留三个常驻 tab
2. 它们本身就是可直接使用的 tab
3. resident 空态只显示 icon
4. dynamic 空态显示 `New Tab`
5. 非空态统一显示真实内容标题

## 后续建议

如果继续推进，下一步最值得做的是：

1. 给 `pdf` 补齐真实空态 tab
2. 收敛 resident entry 的命名，避免继续出现 `placeholder` 一类旧术语
3. 把拖拽和关闭策略也补成明确规则

当前可以先固定的核心结论是：

“顶部三个是可直接使用的常驻 tab；`New Tab` 只应该服务于后续新建出来的空态 tab。”
