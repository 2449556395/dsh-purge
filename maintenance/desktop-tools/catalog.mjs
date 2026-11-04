// Catalog entries are ordinary user prompts, never system-prompt overrides.
const definitions = [
  ['patch','最小补丁','目标：[问题]；范围：[文件]。先复现，做最小修改，保留无关改动。只使用当前会话已有工具。按问题、变更、实际验证和未验证项输出。'],
  ['schedule','定时任务','事项：[内容]；周期：[规则]；时区：[时区]；工作区：[路径]；通知条件：[条件]。先列出下次触发时间和取消方法。未明确要求创建时只给计划。'],
  ['compat','上游兼容性审查','比较[版本 A]与[版本 B]，分别记录源码、安装包和运行时版本。分类列出 API、配置、数据格式和界面变化，区分证据和推测。'],
  ['diagnose','故障复现','环境：[版本]；输入：[最小样本]；现象：[实际结果]。每次只改一个变量，记录首次失败位置；区分模型回复、提供方错误、工具错误和客户端错误。'],
  ['review','只读代码审查','仅审查[范围]，不修改文件。按影响列出触发条件、对应位置和最小验证。未发现问题时说明覆盖范围。'],
  ['release','发布和回退','目标：[版本和 profile]。先记录来源和校验值，再分别验证安装、加载和实际使用。保留无关配置；任一门槛未通过则停止覆盖。']
];
const catalog = Object.freeze(definitions.map(([id,title,text])=>Object.freeze({id,title,text})));
export function listTemplates() { return catalog.map(({id,title})=>({id,title})); }
export function getTemplate(id) {
  const found=catalog.find(item=>item.id===id);
  if(!found)throw new Error('Unknown template id');
  return { ...found };
}
