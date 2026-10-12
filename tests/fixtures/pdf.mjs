// Literal synthetic PDFs; offsets are byte offsets in the generated PDF, not medical labels.
export function syntheticPdf(pageTexts=['Synthetic source']) {
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',null];
 const pages=[];
 for(const text of pageTexts){const pageId=objects.length+1,streamId=pageId+1,fontId=pageId+2;pages.push(pageId);const escaped=text.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');const stream=`BT /F1 12 Tf 20 100 Td (${escaped}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');}
 objects[1]=`<< /Type /Pages /Kids [${pages.map(i=>i+' 0 R').join(' ')}] /Count ${pages.length} >>`;
 let out='%PDF-1.4\n';const offsets=[];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(out);
}
