import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

export default function ZoomableImage({src,previewSrc='',alt='',scale,onScaleChange,className=''}:{src:string;previewSrc?:string;alt?:string;scale:number;onScaleChange:(scale:number)=>void;className?:string}) {
    const frameRef=useRef<HTMLDivElement>(null);
    const imageRef=useRef<HTMLImageElement>(null);
    const pointers=useRef(new Map<number,Point>());
    const gesture=useRef<{distance:number;scale:number;position:Point;center:Point}|null>(null);
    const drag=useRef<{pointerId:number;start:Point;position:Point}|null>(null);
    const [position,setPosition]=useState<Point>({x:0,y:0});
    const [loaded,setLoaded]=useState(false);
    const [failed,setFailed]=useState(false);
    const [moving,setMoving]=useState(false);

    useEffect(()=>{setLoaded(false);setFailed(false);setPosition({x:0,y:0});pointers.current.clear();gesture.current=null;drag.current=null},[src]);
    useEffect(()=>{if(scale<=1)setPosition({x:0,y:0})},[scale]);

    const clamp=(next:Point,nextScale=scale):Point=>{
        const frame=frameRef.current,img=imageRef.current;
        if(!frame||!img||nextScale<=1)return{x:0,y:0};
        const maxX=Math.max(0,(img.offsetWidth*nextScale-frame.clientWidth)/2)+28;
        const maxY=Math.max(0,(img.offsetHeight*nextScale-frame.clientHeight)/2)+28;
        return{x:Math.max(-maxX,Math.min(maxX,next.x)),y:Math.max(-maxY,Math.min(maxY,next.y))};
    };
    const zoomAt=(nextScale:number,clientX:number,clientY:number,basePosition=position,baseScale=scale)=>{
        const frame=frameRef.current;if(!frame)return;
        const bounded=Math.min(6,Math.max(1,nextScale));
        const rect=frame.getBoundingClientRect();
        const focal={x:clientX-(rect.left+rect.width/2),y:clientY-(rect.top+rect.height/2)};
        const ratio=bounded/baseScale;
        const next={x:focal.x-(focal.x-basePosition.x)*ratio,y:focal.y-(focal.y-basePosition.y)*ratio};
        onScaleChange(bounded);setPosition(clamp(next,bounded));
    };
    const pointerCenter=()=>{const values=[...pointers.current.values()];return{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2}};
    const pointerDistance=()=>{const values=[...pointers.current.values()];return Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)};
    const onPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
        event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});setMoving(true);
        if(pointers.current.size===2){gesture.current={distance:pointerDistance(),scale,position,center:pointerCenter()};drag.current=null}
        else if(scale>1)drag.current={pointerId:event.pointerId,start:{x:event.clientX,y:event.clientY},position};
    };
    const onPointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
        if(!pointers.current.has(event.pointerId))return;event.stopPropagation();
        pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(pointers.current.size===2&&gesture.current){
            const nextScale=gesture.current.scale*pointerDistance()/Math.max(1,gesture.current.distance);
            const center=pointerCenter();zoomAt(nextScale,center.x,center.y,gesture.current.position,gesture.current.scale);return;
        }
        if(drag.current?.pointerId===event.pointerId&&scale>1)setPosition(clamp({x:drag.current.position.x+event.clientX-drag.current.start.x,y:drag.current.position.y+event.clientY-drag.current.start.y}));
    };
    const release=(event:React.PointerEvent<HTMLDivElement>)=>{event.stopPropagation();pointers.current.delete(event.pointerId);if(pointers.current.size<2)gesture.current=null;if(drag.current?.pointerId===event.pointerId)drag.current=null;setMoving(pointers.current.size>0)};
    return <div ref={frameRef} className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden ${scale>1?'cursor-grab active:cursor-grabbing':''} ${className}`} style={{touchAction:'none'}}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release}
        onWheel={event=>{event.preventDefault();zoomAt(scale*(event.deltaY<0?1.16:.86),event.clientX,event.clientY)}}
        onDoubleClick={event=>{event.stopPropagation();if(scale>1){onScaleChange(1);setPosition({x:0,y:0})}else zoomAt(2.25,event.clientX,event.clientY)}}>
        {previewSrc&&!loaded&&<img src={previewSrc} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-contain blur-[0.5px]"/>}
        {!failed&&<img ref={imageRef} src={src} alt={alt} draggable={false} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} className={`max-h-full max-w-full object-contain opacity-0 ${loaded?'opacity-100':''} ${moving?'':'transition-[transform,opacity] duration-200'}`} style={{transform:`translate3d(${position.x}px,${position.y}px,0) scale(${scale})`,transformOrigin:'center'}}/>}
        {failed&&<div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-dark-400">نمایش عکس انجام نشد.</div>}
    </div>;
}
