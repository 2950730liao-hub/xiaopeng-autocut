import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';

export const cacheKey=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function fileKey(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeCached(file,write){
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp${path.extname(file)}`;
  try {
    await write(temporary);
    await rename(temporary,file);
  } catch(error){
    await rm(temporary,{force:true});
    throw error;
  }
}
