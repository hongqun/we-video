// 此字符串由浏览器直接解析，内部只使用原生 API，不引用服务端闭包。
export const DIAGRAM_INSPECTION_SCRIPT = String.raw`async ({svg, bindings, endpointKinds, area, fonts}) => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;width:960px;height:800px';
  const style = document.createElement('style');
  style.textContent = fonts.map((bytes, i) => '@font-face{font-family:"Studio ' + (i ? 'Serif' : 'Sans') + '";src:url(data:font/woff2;base64,' + bytes + ');font-weight:100 900}').join('');
  document.head.appendChild(style);
  const host = document.createElement('div');
  host.style.cssText = 'width:960px;height:800px;font-family:Studio Sans';
  host.innerHTML = svg;
  document.body.appendChild(host);
  const root = host.querySelector('svg');
  root.setAttribute('width', '960'); root.setAttribute('height', '800'); root.setAttribute('font-family', 'Studio Sans');
  await document.fonts.load('400 24px "Studio Sans"');
  await document.fonts.load('700 24px "Studio Sans"');
  await document.fonts.load('400 24px "Studio Serif"');
  await document.fonts.ready;
  const errors = [], repairs = [];
  // 每个错误都带稳定代码与分组 ID，便于补丁只修改真正失败的元素。
  const issue = (message, repair) => {errors.push(message); repairs.push(repair);};
  const rect = root.getBoundingClientRect();
  const boxOf = el => {
    const b = el.getBoundingClientRect();
    return {x:b.left-rect.left,y:b.top-rect.top,width:b.width,height:b.height};
  };
  // 将真实字体度量和安全区反馈给模型，避免仅凭 SVG 基线坐标反复猜测越界原因。
  const describeBox = b => 'x='+b.x.toFixed(1)+', y='+b.y.toFixed(1)+', width='+b.width.toFixed(1)+', height='+b.height.toFixed(1);
  const check = (el, name, groupId) => {
    const b = boxOf(el);
    if ((b.width || b.height) && (b.x < -1 || b.y < -1 || b.x+b.width > 961 || b.y+b.height > 801)) issue(name+' 超出画布', {groupId,code:'outside_canvas',bounds:b,instruction:'调整本组实际几何至 960×800 画布内。'});
    return b;
  };
  // 每种动画角色都检查边界；水平/竖直数据线可以只有一个非零维度。
  const elements = bindings.map(binding => {
    const el = document.getElementById(binding.groupId);
    const box = check(el, binding.name, binding.groupId);
    if (!box.width && !box.height) issue(binding.name+' 没有可见几何内容', {groupId:binding.groupId,code:'empty_geometry',instruction:'添加本组对应的可见几何。'});
    if (box.x < area.x || box.y < area.y || box.x+box.width > area.x+area.width || box.y+box.height > area.y+area.height) issue(binding.name+' 超出人物安全区；实际范围 ['+describeBox(box)+']，安全范围 ['+describeBox(area)+']；标题和标签也必须在安全区内，text 的 y 是基线而非顶边', {groupId:binding.groupId,code:'outside_safe_area',bounds:box,safeArea:area,instruction:'把整个分组及文字移入安全区；text.y 是基线，须预留字高。'});
    // 主形状用于检查连接点与文字，opening 的标题不再被误判属于装饰徽章。
    const shape = el.querySelector('rect,circle,ellipse,polygon');
    return {id:binding.groupId, kind:binding.kind, el, box, shape, boundary:shape ? boxOf(shape) : box};
  });
  // 只有实体节点执行文字包围与节点互斥，区域、数据系列和独立标签允许有意重叠。
  const nodes = elements.filter(element => element.kind === 'node');
  root.querySelectorAll('text,tspan').forEach(el => {
    const owner = elements.find(n => n.el.contains(el));
    const groupId = owner ? owner.id : 'opening';
    const b = check(el, '文字“'+el.textContent+'”', groupId);
    const node = nodes.find(n => n.el.contains(el));
    if (node && node.shape) {
      const c = node.boundary;
      if (b.x < c.x-2 || b.y < c.y-2 || b.x+b.width > c.x+c.width+2 || b.y+b.height > c.y+c.height+2) issue('文字“'+el.textContent+'”超出所属节点', {groupId:node.id,code:'text_overflow',text:el.textContent,textBounds:b,shapeBounds:c,instruction:'按真实文字宽高扩大主形状或分行排版；中文不得缩至 12px 以下。'});
    }
    if (/[\u3400-\u9fff]/u.test(el.textContent) && parseFloat(getComputedStyle(el).fontSize) < 12) issue('中文文字“'+el.textContent+'”小于 12px', {groupId,code:'text_too_small',bounds:b,instruction:'将中文字号提高到至少 12px，并重新检查所属形状边界。'});
  });
  for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
    const a=nodes[i].box,b=nodes[j].box;
    const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    if (overlap > Math.min(a.width*a.height,b.width*b.height)*0.25) issue('节点 '+nodes[i].id+' 与 '+nodes[j].id+' 明显重叠', {groupId:nodes[i].id,code:'node_overlap',bounds:a,relatedGroupIds:[nodes[j].id],instruction:'调整节点位置；只有真实区域或数据标记可以有意重叠。'});
  }
  // 使用形状自身的填充区域，避免圆形/菱形边界被矩形包围盒误判为内部。
  const inside = (node,x,y) => {
    if (node.shape && typeof node.shape.isPointInFill === 'function') {
      const point = root.createSVGPoint(); point.x=x+rect.left; point.y=y+rect.top;
      return node.shape.isPointInFill(point.matrixTransform(node.shape.getScreenCTM().inverse()));
    }
    const b=node.boundary;
    return x>b.x && x<b.x+b.width && y>b.y && y<b.y+b.height;
  };
  const nearBoundary = (node,x,y,gap) => {
    const samples = [[0,0],[gap,0],[-gap,0],[0,gap],[0,-gap],[gap,gap],[gap,-gap],[-gap,gap],[-gap,-gap]].map(p => inside(node,x+p[0],y+p[1]));
    return samples.some(Boolean) && samples.some(v => !v);
  };
  const edges=[];
  for (const binding of bindings.filter(b => b.kind === 'edge' || b.kind === 'connector')) {
    const group=document.getElementById(binding.groupId);
    const directed=binding.kind === 'edge';
    const paths=Array.from(group.querySelectorAll('path,line,polyline')).filter(el => !directed || el.hasAttribute('marker-end'));
    if (!paths.length) issue('连线“'+binding.name+'”'+(directed ? '缺少 marker-end 箭头' : '缺少有效连接路径'), {groupId:binding.groupId,code:'missing_arrow',instruction:directed ? '为真实有向路径添加本地 marker-end。' : '添加连接两个端点的有效路径。'});
    const endpoints=elements.filter(n => binding.after.includes(n.id) && endpointKinds.includes(n.kind));
    if (endpoints.length < 2) issue('连线“'+binding.name+'”必须依赖两个有效端点元素', {groupId:binding.groupId,code:'invalid_endpoints',instruction:'将 after 设置为两个真实 node/region/mark 端点。'});
    for (const el of paths) {
      const length=el.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) {issue('连线“'+binding.name+'”没有有效长度', {groupId:binding.groupId,code:'invalid_path_length',instruction:'替换为空间中连接真实端点的非零长度路径。'}); continue;}
      const point=el.getPointAtLength(length).matrixTransform(el.getScreenCTM());
      const x=point.x-rect.left,y=point.y-rect.top;
      edges.push({id:binding.groupId,x,y});
      // 端点应接近依赖节点边缘，不能深入卡片内部后被填色遮住。
      const targets=endpoints.filter(n => nearBoundary(n,x,y,6));
      // 终点靠近边界仍可能沿着边缘悬空；箭头最后一段必须朝向目标内部。
      if (directed && targets.length && targets.every(n => n.shape)) {
        const previous=el.getPointAtLength(Math.max(0,length-Math.min(1,length/2))).matrixTransform(el.getScreenCTM());
        const dx=point.x-previous.x,dy=point.y-previous.y,magnitude=Math.hypot(dx,dy);
        if (magnitude > 0 && !targets.some(n => [2,4,8,12].some(distance => inside(n,x+dx/magnitude*distance,y+dy/magnitude*distance)))) {
          issue('连线“'+binding.name+'”箭头方向未指向目标节点，终点虽靠近边界但仍悬空', {groupId:binding.groupId,code:'arrow_direction',relatedGroupIds:targets.map(n => n.id),instruction:'调整最后一个折点和终点，让箭头朝向实际目标内部并接触其边界；不能仅把终点移到边界旁。'});
        }
      }
      if (!targets.length) {
        errors.push('连线“'+binding.name+'”'+(directed ? '箭头终点' : '终点')+' ('+Math.round(x)+','+Math.round(y)+') 未落在端点边界；候选端点：'+endpoints.map(n => n.id+' ['+describeBox(n.boundary)+']').join('、')+'；请修正连接点；若只是包含关系可保留区域并移除多余关系线');
        // 给出连线 ID 与经过实际形状验证的参考点；不把包围盒角点当成圆形或菱形边界。
        const candidates=endpoints.map(n => {
          const b=n.boundary, cx=Math.max(b.x,Math.min(x,b.x+b.width)), cy=Math.max(b.y,Math.min(y,b.y+b.height));
          const points=[{x:b.x,y:cy},{x:b.x+b.width,y:cy},{x:cx,y:b.y},{x:cx,y:b.y+b.height}].filter(p => nearBoundary(n,p.x,p.y,2)).sort((a,b) => Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
          return {id:n.id,kind:n.kind,boundary:b,nearestBoundaryPoint:points[0]};
        });
        const containers=endpoints.filter(n => n.kind === 'region' && endpoints.some(other => other.id !== n.id && other.boundary.x >= n.boundary.x && other.boundary.y >= n.boundary.y && other.boundary.x+other.boundary.width <= n.boundary.x+n.boundary.width && other.boundary.y+other.boundary.height <= n.boundary.y+n.boundary.height)).map(n => n.id);
        repairs.push({groupId:binding.groupId,code:'endpoint_off_boundary',end:{x,y},candidates,containingRegions:containers,instruction:containers.length ? '先判断是否仅表达包含关系：若是，删除该连线 SVG 组及对应 binding，并移除其他 binding.after 对该连线的引用；若有真实方向关系，选定实际目标并重画路径至其边界。不能仅改 after，也不能把终点接回源节点来消除报错。' : '选定真实目标并修改路径坐标，使箭头接触目标边界；参考点需结合方向与路由选择，不代表自动选择的目标。'});
      }
      // 无向连接两端均须接触不同的依赖元素，不要求 marker-end。
      if (!directed) {
        const start=el.getPointAtLength(0).matrixTransform(el.getScreenCTM());
        if (!endpoints.some(n => nearBoundary(n,start.x-rect.left,start.y-rect.top,6) && targets.some(target => target.id !== n.id))) issue('连线“'+binding.name+'”起点和终点必须落在不同端点边界', {groupId:binding.groupId,code:'connector_endpoints',instruction:'将路径两端连接至不同的真实依赖端点边界。'});
      }
      for (const n of nodes) {
        if (inside(n,x,y) && !nearBoundary(n,x,y,2)) issue('连线“'+binding.name+'”箭头终点位于节点 '+n.id+' 内部，会被遮挡', {groupId:binding.groupId,code:'endpoint_inside_node',bounds:n.boundary,relatedGroupIds:[n.id],instruction:'把终点移至目标边界，不要深入节点填充区域。'});
      }
      // 非端点节点不得遮住路由；采样只检测明显穿越，不替代完整路径相交算法。
      for (const n of nodes.filter(n => !binding.after.includes(n.id))) {
        for (let step=1;step<40;step++) {
          const point=el.getPointAtLength(length*step/40).matrixTransform(el.getScreenCTM());
          if (inside(n,point.x-rect.left,point.y-rect.top)) {
            issue('连线“'+binding.name+'”穿过非端点节点 '+n.id, {groupId:binding.groupId,code:'edge_crosses_node',path:el.outerHTML,obstructionId:n.id,obstructionBounds:n.boundary,instruction:'使用 replace_group 修改这条路径，绕过障碍节点并预留间距；不要将障碍加入 after 来绕过检查。'});
            break;
          }
        }
      }
    }
  }
  return {errors,repairs,elements:elements.map(n => ({id:n.id,kind:n.kind,...n.box,boundary:n.boundary})),nodes:nodes.map(n => ({id:n.id,...n.box})),edges};
}`;
