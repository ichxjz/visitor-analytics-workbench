import {open,realpath} from 'node:fs/promises';

// Only server configuration supplies filenames; no URL parameter reaches the filesystem.
// Repeated real files (including symlink aliases) are read once, never double counted.
export function createLocalLogReader({files,maxBytes=32*1024*1024,maxTotalBytes=64*1024*1024}={}){
  if(!Array.isArray(files)||!files.length||files.length>8||files.some(file=>typeof file!=='string'||!file||file.includes('\0')))throw new TypeError('Configure one to eight plain-text Nginx log files.');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>64*1024*1024)throw new TypeError('Invalid log byte limit.');
  return async()=>{
    const seen=new Set(),chunks=[];let total=0;
    for(const file of files){
      let handle;
      try{
        const resolved=await realpath(file);handle=await open(resolved,'r');const stat=await handle.stat();
        if(!stat.isFile())throw new Error('not a regular file');
        const id=`${stat.dev}:${stat.ino}`;if(seen.has(id))continue;seen.add(id);
        const size=Math.min(stat.size,maxBytes,maxTotalBytes-total);if(size<=0)break;
        const start=stat.size-size,offset=start>0?start-1:0;
        const buffer=Buffer.alloc(size+(start>0?1:0));let read=0;
        while(read<buffer.length){const result=await handle.read(buffer,read,buffer.length-read,offset+read);if(!result.bytesRead)break;read+=result.bytesRead;}
        let text=buffer.subarray(0,read).toString('utf8');
        // Tail windows start mid-record: discard that record, never parse a partial line.
        if(start>0){const boundary=text.indexOf('\n');text=boundary<0?'':text.slice(boundary+1);}
        chunks.push(text);total+=size;
      }catch{throw Object.assign(new Error('无法读取已配置的本机日志。请核对文件存在、读取权限及纯文本格式后重试。'),{status:503});}
      finally{await handle?.close();}
    }
    return chunks.join('\n');
  };
}
