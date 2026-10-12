// Disposable text-layer PDF used only by HTTP/browser fixture tests.
export function fixturePdf(text='Record feelings.') {
  const stream=`BT /F1 12 Tf 50 100 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(out));out+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
