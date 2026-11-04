将 strings 对象中的所有值翻译为简洁准确的英文。直接返回以原 JSON Pointer 为键、英文译文为值的 JSON 对象，不增加包装层。保留数字、专名及事实。cueText、polygons/text 必须逐字摘自 narrationByScene 对应的英文确认段落。根据 previousErrors 修复失败字段。
