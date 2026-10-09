// Answers used when no AI is reachable (offline, or AI not configured where the app is hosted).
// They are built only from the rule engine's findings, are labelled as such in the UI, and come in
// the same three languages, so every button still does something useful.
import type { Finding, Invoice, InvoiceVerdict } from '../domain/types';
import { formatINR } from '../lib/format';
import { plainFor } from '../ui/plain';
import type { FollowUp, Lang } from './tasks';

export function rulesVerdict(inv: Invoice, findings: Finding[], v: InvoiceVerdict, lang: Lang): string {
  const main = [...findings].sort((a, b) => b.itcAtRisk - a.itcAtRisk)[0];
  const p = main ? plainFor(main) : null;
  const safe = v.itcClaimed - v.itcAtRisk;
  const sup = inv.supplier.name || 'the supplier';
  if (lang === 'Telugu') {
    if (!main) return `ఈ బిల్లు అన్ని తనిఖీలు పాసైంది. ${formatINR(v.itcClaimed)} GST క్రెడిట్ సురక్షితంగా క్లెయిమ్ చేయవచ్చు.`;
    return `${formatINR(v.itcAtRisk)} GST క్రెడిట్ ప్రస్తుతం నిలిచిపోయింది${safe > 0 ? `; ${formatINR(safe)} సురక్షితంగా క్లెయిమ్ చేయవచ్చు` : ''}. ప్రధాన సమస్య: ${p!.title} (${main.ruleId}). తదుపరి చర్య: ${sup}ను సంప్రదించి సరిచేసిన బిల్లు అడగండి, ఆ తర్వాతే క్లెయిమ్ చేయండి.`;
  }
  if (lang === 'Hindi') {
    if (!main) return `यह बिल सभी जाँचों में पास है। ${formatINR(v.itcClaimed)} का GST क्रेडिट सुरक्षित रूप से क्लेम कर सकते हैं।`;
    return `${formatINR(v.itcAtRisk)} का GST क्रेडिट अभी अटका है${safe > 0 ? `; ${formatINR(safe)} सुरक्षित रूप से क्लेम कर सकते हैं` : ''}। मुख्य समस्या: ${p!.title} (${main.ruleId})। अगला कदम: ${sup} से संपर्क करके सही बिल मँगवाइए, उसके बाद ही क्लेम कीजिए।`;
  }
  if (!main) return `This bill passed every check. You can safely claim ${formatINR(v.itcClaimed)} of GST credit.`;
  return `${formatINR(v.itcAtRisk)} of GST credit is stuck on this bill${safe > 0 ? `; ${formatINR(safe)} is safe to claim` : ''}. Main problem: ${p!.title.toLowerCase()}. ${p!.why} Next step: ${p!.todo}`;
}

type Issue = { invoiceNo: string; date: string; problem: string; ask: string; itc: number };

export function templateFollowUpLang(company: { name: string; gstin: string }, vendor: { name: string; gstin: string }, issues: Issue[], lang: Lang, english: FollowUp): FollowUp {
  const total = formatINR(issues.reduce((s, i) => s + i.itc, 0));
  const list = issues.map((i, k) => `${k + 1}. Invoice ${i.invoiceNo} (${i.date}): ${i.problem}`).join('\n');
  if (lang === 'Telugu') {
    return {
      subject: english.subject,
      email: `ప్రియమైన ${vendor.name} బృందానికి,\n\nGSTR-2B తో మా కొనుగోళ్లను సరిపోల్చినప్పుడు, మీరు మాకు (GSTIN ${company.gstin}) ఇచ్చిన ఈ బిల్లుల్లో సమస్యలు కనిపించాయి:\n\n${list}\n\nవీటి వల్ల ${total} GST క్రెడిట్ నిలిచిపోయింది. దయచేసి 11వ తేదీలోగా సరిచేసిన బిల్లు / క్రెడిట్ నోట్ పంపి, GSTR-1 లో సరిచేయండి.\n\nధన్యవాదాలు,\nఅకౌంట్స్ టీమ్\n${company.name}`,
      whatsapp: `నమస్కారం ${vendor.name}, ${company.name} అకౌంట్స్ నుంచి. ${issues.length} బిల్లుల్లో GST సవరణలు కావాలి: ${issues.map((i) => i.invoiceNo).join(', ')}. ${total} క్రెడిట్ నిలిచిపోయింది. దయచేసి 11వ తేదీలోగా సరిచేయండి.`,
    };
  }
  if (lang === 'Hindi') {
    return {
      subject: english.subject,
      email: `प्रिय ${vendor.name} टीम,\n\nGSTR-2B से हमारी ख़रीद का मिलान करते समय आपके द्वारा हमें (GSTIN ${company.gstin}) दिए गए इन बिलों में समस्याएँ मिलीं:\n\n${list}\n\nइनकी वजह से ${total} का GST क्रेडिट अटका हुआ है। कृपया 11 तारीख़ से पहले सुधरा हुआ बिल / क्रेडिट नोट भेजें और GSTR-1 में सुधार करें।\n\nधन्यवाद,\nअकाउंट्स टीम\n${company.name}`,
      whatsapp: `नमस्ते ${vendor.name}, ${company.name} अकाउंट्स से। ${issues.length} बिलों में GST सुधार चाहिए: ${issues.map((i) => i.invoiceNo).join(', ')}। ${total} का क्रेडिट अटका है। कृपया 11 तारीख़ से पहले सुधारें।`,
    };
  }
  return english;
}
