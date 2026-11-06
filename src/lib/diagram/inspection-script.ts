// 此字符串由浏览器直接解析，内部只使用原生 API，不引用服务端闭包。
export const DIAGRAM_INSPECTION_SCRIPT = String.raw`async ({svg, bindings, area, fonts}) => {
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
  const errors = [];
  const rect = root.getBoundingClientRect();
  const boxOf = el => {
    const b = el.getBoundingClientRect();
    return {x:b.left-rect.left,y:b.top-rect.top,width:b.width,height:b.height};
  };
  const check = (el, name) => {
    const b = boxOf(el);
    if (b.width && b.height && (b.x < -1 || b.y < -1 || b.x+b.width > 961 || b.y+b.height > 801)) errors.push(name+' 超出画布');
    return b;
  };
  const nodes = bindings.filter(b => b.kind === 'node').map(binding => {
    const el = document.getElementById(binding.groupId);
    const box = check(el, binding.name);
    if (!box.width || !box.height) errors.push(binding.name+' 没有可见几何内容');
    if (box.x < area.x || box.y < area.y || box.x+box.width > area.x+area.width || box.y+box.height > area.y+area.height) errors.push(binding.name+' 超出人物安全区');
    // 主形状用于检查连接点与文字，opening 的标题不再被误判属于装饰徽章。
    const shape = el.querySelector('rect,circle,ellipse,polygon');
    return {id:binding.groupId, el, box, shape, boundary:shape ? boxOf(shape) : box};
  });
  root.querySelectorAll('text').forEach(el => {
    const b = check(el, '文字“'+el.textContent+'”');
    const node = nodes.find(n => n.el.contains(el));
    if (node && node.shape) {
      const c = node.boundary;
      if (b.x < c.x-2 || b.y < c.y-2 || b.x+b.width > c.x+c.width+2 || b.y+b.height > c.y+c.height+2) errors.push('文字“'+el.textContent+'”超出所属节点');
    }
    if (/[\u3400-\u9fff]/u.test(el.textContent) && parseFloat(getComputedStyle(el).fontSize) < 12) errors.push('中文文字“'+el.textContent+'”小于 12px');
  });
  for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
    const a=nodes[i].box,b=nodes[j].box;
    const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    if (overlap > Math.min(a.width*a.height,b.width*b.height)*0.25) errors.push('节点 '+nodes[i].id+' 与 '+nodes[j].id+' 明显重叠');
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
  for (const binding of bindings.filter(b => b.kind === 'edge')) {
    const group=document.getElementById(binding.groupId);
    const paths=Array.from(group.querySelectorAll('path,line,polyline')).filter(el => el.hasAttribute('marker-end'));
    if (!paths.length) errors.push('连线“'+binding.name+'”缺少 marker-end 箭头');
    const endpoints=nodes.filter(n => binding.after.includes(n.id));
    for (const el of paths) {
      const length=el.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) {errors.push('连线“'+binding.name+'”没有有效长度'); continue;}
      const point=el.getPointAtLength(length).matrixTransform(el.getScreenCTM());
      const x=point.x-rect.left,y=point.y-rect.top;
      edges.push({id:binding.groupId,x,y});
      // 端点应接近依赖节点边缘，不能深入卡片内部后被填色遮住。
      if (!endpoints.some(n => nearBoundary(n,x,y,6))) errors.push('连线“'+binding.name+'”箭头终点 ('+Math.round(x)+','+Math.round(y)+') 未落在节点边界；请修正连接点，而非仅放大箭头');
      for (const n of nodes) {
        if (inside(n,x,y) && !nearBoundary(n,x,y,2)) errors.push('连线“'+binding.name+'”箭头终点位于节点 '+n.id+' 内部，会被遮挡');
      }
      // 非端点节点不得遮住路由；采样只检测明显穿越，不替代完整路径相交算法。
      for (const n of nodes.filter(n => !binding.after.includes(n.id))) {
        for (let step=1;step<40;step++) {
          const point=el.getPointAtLength(length*step/40).matrixTransform(el.getScreenCTM());
          if (inside(n,point.x-rect.left,point.y-rect.top)) {errors.push('连线“'+binding.name+'”穿过非端点节点 '+n.id);break;}
        }
      }
    }
  }
  return {errors,nodes:nodes.map(n => ({id:n.id,...n.box})),edges};
}`;
