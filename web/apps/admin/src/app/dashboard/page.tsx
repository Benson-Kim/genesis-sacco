import { Card, DataTable, LayoutShell, apps, avatar, cls, loans, members, money, monthly, pill } from './genesis-prototype';

export default function DashboardHomePage() {
  const deposits = members.reduce((s, m) => s + m[3], 0);
  const shares = members.reduce((s, m) => s + m[4], 0);
  const book = loans.reduce((s, l) => s + l[3], 0);
  const npl = loans.filter((l) => l[7] > 90).reduce((s, l) => s + l[3], 0);
  return (
    <LayoutShell active="/dashboard">
      <div className="gp-grid gp-kpis">
        <Card><div className="gp-stat-label">Active members</div><div className="gp-stat-value">{members.length}</div></Card>
        <Card><div className="gp-stat-label">Deposits</div><div className="gp-stat-value">{money(deposits)}</div></Card>
        <Card><div className="gp-stat-label">Share capital</div><div className="gp-stat-value">{money(shares)}</div></Card>
        <Card><div className="gp-stat-label">Loan book</div><div className="gp-stat-value">{money(book)}</div></Card>
      </div>
      <div className="gp-grid gp-two" style={{marginTop:16}}>
        <Card><h2 className="gp-section-title">Collections vs disbursements</h2><div className="gp-bars">{monthly.map(([m,a,b])=><div key={m} style={{flex:1}}><div className="gp-bar-pair"><div className="gp-bar" style={{height:`${String(a * 6)}px`,background:'var(--navy)'}}/><div className="gp-bar" style={{height:`${String(b * 6)}px`,background:'var(--gold)'}}/></div><div className="gp-bar-label">{m}</div></div>)}</div></Card>
        <Card><div className="gp-hero"><div className="l">Performing portfolio</div><div className="v">{money(book-npl)}</div></div><div style={{marginTop:12}}><div className="gp-row"><span className="k">PAR &gt; 30</span><span className="val">{Math.round((loans.filter(l=>l[7]>30).reduce((s,l)=>s+l[3],0)/book)*100)}%</span></div><div className="gp-row"><span className="k">NPL exposure</span><span className="val">{money(npl)}</span></div><div className="gp-row"><span className="k">Pending applications</span><span className="val">{apps.filter(a=>!['Approved','Rejected'].includes(a[8])).length}</span></div></div></Card>
      </div>
      <div className="gp-grid gp-two" style={{marginTop:16}}>
        <DataTable heads={['Member','Type','Deposits','Shares','Loan','Status']}>{members.slice(0,5).map(m=><tr key={m[1]}><td><div className="gp-mrow">{avatar(m[0],m[2])}<div><b>{m[0]}</b><br/><span className="gp-sub">{m[1]}</span></div></div></td><td>{m[2]}</td><td className="r">{money(m[3])}</td><td className="r">{money(m[4])}</td><td className="r">{money(m[5])}</td><td>{pill(m[6],m[6]==='Arrears'?'watch':'good')}</td></tr>)}</DataTable>
        <DataTable heads={['Borrower','Product','Balance','Class']}>{loans.slice(0,5).map(l=>{const c=cls(l[7]);return <tr key={l[1]}><td><b>{l[0]}</b><br/><span>{l[1]}</span></td><td>{l[2]}</td><td className="r">{money(l[3])}</td><td>{pill(c[0],c[1])}</td></tr>})}</DataTable>
      </div>
    </LayoutShell>
  );
}
