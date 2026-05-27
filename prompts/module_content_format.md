记忆模块 content_html 须为 Wiki 风格结构化 HTML（不要用纯段落堆砌），根元素示例：
<article class="wiki-doc" data-title="兴趣爱好">...</article>

- data-title：中文模块名（界面展示用）
- 磁盘文件名由 module_id 决定，仅英文 slug，如 hobbies.html

推荐结构（按信息量选用，可组合）：
1. <section class="wiki-section"><h3>概览</h3><p>一两句摘要</p></section>
2. <section class="wiki-section"><h3>条目</h3><table class="wiki-table"><thead><tr><th>项</th><th>说明</th></tr></thead><tbody><tr><td>...</td><td>...</td></tr></tbody></table></section>
3. <section class="wiki-section"><h3>列表</h3><ul class="wiki-list"><li>...</li></ul></section>
4. <section class="wiki-section"><h3>属性</h3><dl class="wiki-dl"><dt>键</dt><dd>值</dd></dl></section>
5. <section class="wiki-section"><h3>备注</h3><p class="wiki-note">补充说明</p></section>

分节语义（勿写反）：
- **概览**：模块级稳定摘要（用户长期是什么倾向），一两句话；不要写本次对话的临时问题、待办、正在找的推荐
- **列表 / 条目**：可枚举的具体事实、分类项；短期状态、当前诉求、待办放这里或「备注」，例如「当前关注：网球鞋推荐」
- **备注**：补充说明、时效性信息

规则：
- 每个 section 有明确 h3 标题；表格用 thead/tbody；合并更新时保留已有结构，只改对应 section
- 禁止只输出单个 <p> 长文本；信息少时至少「概览」+「列表」或「属性」
- 标签内文本可中文；不要 markdown；特殊字符在 HTML 中正确转义
- 输出必须一次符合上述结构；服务端不做纯文本或残缺 HTML 的自动补全，不合规将被丢弃并记错误日志
