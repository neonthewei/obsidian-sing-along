const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {parseTime,formatTime,videoId,parseLyrics,updateTiming,clearTiming,rangeFor,activeAt}=require('../src/core');
const song=fs.readFileSync(require('node:path').join(__dirname,'fixtures/practice-song.md'),'utf8');
const sample='---\ntitle: 練唱\n---\n\n## 歌詞對照\n\n### 副歌\n\n*A*  \n**日文甲**  \n中文甲\n\n*B*  \n**日文乙**  \n中文乙\n\n*A*  \n**日文甲**  \n中文甲\n\n## 歌名\n不該被解析';
test('time parsing preserves zero, fractions and long durations; rejects invalid input',()=>{
 for(const [input,result] of [['00:00',0],['01:23.5',83.5],['120:00.001',7200.001],['23.25',23.25],['1:60',null],['',null],['-1',null],['abc',null]])assert.equal(parseTime(input),result);
 assert.equal(formatTime(59.9996),'01:00.000');
});
test('YouTube URLs accept official formats and reject hostile or invalid hosts',()=>{
 for(const url of ['https://youtu.be/M7lc1UVf-VE?t=3','https://www.youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com/shorts/M7lc1UVf-VE','https://youtube.com/live/M7lc1UVf-VE'])assert.equal(videoId(url),'M7lc1UVf-VE');
 for(const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','javascript:alert(1)','file:///M7lc1UVf-VE','https://youtube.com/watch?v=short'])assert.equal(videoId(url),null);
});
test('fixture song keeps cues, sections, repeated choruses and existing markers',()=>{
 const cues=parseLyrics(song);assert.equal(cues.length,7);assert.deepEqual([...new Set(cues.map(c=>c.section))],['Verse','Chorus','Outro']);
 assert.equal(cues[0].japanese,'朝の光が窓をたたく');assert.equal(cues[0].start,5);assert.equal(cues[0].end,8.5);assert.equal(cues[1].start,null);
 assert.equal(cues[6].romaji,'Mata ne');assert.equal(new Set(cues.map(c=>c.key)).size,7);assert.ok(!cues.some(c=>c.japanese==='解析しない'));
});
test('repeated lyrics have independent markers and writes preserve unrelated content',()=>{
 const cues=parseLyrics(sample);assert.notEqual(cues[0].key,cues[2].key);
 let content=updateTiming(sample,cues[0].key,0);content=updateTiming(content,cues[2].key,12,15);
 const read=parseLyrics(content);assert.equal(read[0].start,0);assert.equal(read[1].start,null);assert.equal(read[2].start,12);
 content=updateTiming(content,cues[0].key,0.5,3);assert.equal((content.match(/%% sing-along:/g)||[]).length,2);
 content=clearTiming(clearTiming(content,cues[0].key),cues[2].key);assert.equal(content,sample);
 assert.throws(()=>updateTiming(sample,'stale',1),/修改/);
});
test('reject out-of-order and overlapping times without modifying the note',()=>{
 const cues=parseLyrics(sample);let content=updateTiming(sample,cues[0].key,2,5);content=updateTiming(content,cues[2].key,10);
 assert.throws(()=>updateTiming(content,cues[1].key,1),/晚於/);assert.throws(()=>updateTiming(content,cues[1].key,4),/終點/);assert.throws(()=>updateTiming(content,cues[1].key,11),/超過/);assert.throws(()=>updateTiming(content,cues[1].key,6,11),/超過/);assert.throws(()=>updateTiming(content,cues[1].key,6,6),/晚於/);
});
test('loop boundaries do not skip unmarked lyrics, handle last line and gaps',()=>{
 const cues=parseLyrics(sample);let content=updateTiming(sample,cues[0].key,0);content=updateTiming(content,cues[2].key,10);let parsed=parseLyrics(content);
 assert.equal(rangeFor(parsed,0),null);assert.equal(activeAt(parsed,3),-1);assert.deepEqual(rangeFor(parsed,2,15),{start:10,end:15});
 content=updateTiming(content,cues[1].key,5,8);parsed=parseLyrics(content);assert.deepEqual(rangeFor(parsed,0),{start:0,end:5});assert.equal(activeAt(parsed,4.9),0);assert.equal(activeAt(parsed,5),1);assert.equal(activeAt(parsed,8),-1);assert.equal(activeAt(parsed,10,15),2);assert.equal(activeAt(parsed,15,15),-1);
});