import type { ReactNode } from 'react';
import Link from 'next/link';

type NavItem = readonly [string, string, string];
export const nav: ReadonlyArray<readonly [string, ReadonlyArray<NavItem>]> = [
  ['Operations', [['/dashboard', 'Dashboard', 'Portfolio overview'], ['/dashboard/members', 'Members', 'Members'], ['/dashboard/applications', 'Applications', 'Loan applications'], ['/dashboard/loan-book', 'Loan book', 'Loan book'], ['/dashboard/guarantors', 'Guarantors', 'Guarantorship & pledges'], ['/dashboard/ledger', 'Transactions', 'Transactions ledger']]],
  ['Governance', [['/dashboard/committee', 'Credit committee', 'Credit committee review'], ['/dashboard/member-exit', 'Member exit', 'Member exit & settlement']]],
  ['Insights', [['/dashboard/reports', 'Reports', 'Statements & reports']]],
  ['Administration', [['/dashboard/settings', 'Settings', 'Settings'], ['/dashboard/access-control', 'Access control', 'Access control (RBAC)']]],
] as const;

export const members = [
  ['Grace Wanjiru', 'GP-0912', 'Person', 92000, 15000, 40000, 'Active'],
  ['Kifaru Logistics Ltd', 'GP-1130', 'Company', 960000, 200000, 0, 'Active'],
  ['Mwangaza Chama', 'GP-0455', 'Group', 410000, 80000, 180000, 'Active'],
  ['KDU 573T · Matatu', 'GP-0447', 'Vehicle', 185000, 30000, 120000, 'Active'],
  ['Mary Achieng', 'GP-1401', 'Person', 210000, 30000, 260000, 'Active'],
  ['KDQ 886R · Minibus', 'GP-0333', 'Vehicle', 54000, 10000, 90000, 'Arrears'],
] as const;
export const loans = [
  ['Mary Achieng', 'GP-1401', 'Development', 260000, 12, 36, 6, 0],
  ['KDU 573T', 'GP-0447', 'Asset Finance', 120000, 14, 24, 8, 0],
  ['Grace Wanjiru', 'GP-0912', 'Emergency', 40000, 12, 12, 4, 0],
  ['Mwangaza Chama', 'GP-0455', 'Group Loan', 180000, 13, 24, 5, 22],
  ['KDQ 886R', 'GP-0333', 'Asset Finance', 90000, 14, 24, 9, 68],
  ['James Kariuki', 'GP-0640', 'Development', 140000, 12, 36, 14, 120],
  ['Lucy Wambui', 'GP-0517', 'Asset Finance', 220000, 14, 48, 10, 210],
] as const;
export const apps = [
  ['Grace Wanjiru', 'GP-0912', 'Person', 'Development', 250000, 36, 12, 118, 'Committee'],
  ['Peter Otieno', 'GP-0221', 'Person', 'Emergency', 80000, 12, 12, 100, 'Appraisal'],
  ['KDU 573T', 'GP-0447', 'Vehicle', 'Asset Finance', 400000, 48, 14, 88, 'Submitted'],
  ['Kifaru Logistics Ltd', 'GP-1130', 'Company', 'Asset Finance', 300000, 36, 14, 130, 'Approved'],
  ['Lucy Wambui', 'GP-0517', 'Person', 'Development', 150000, 24, 12, 92, 'Rejected'],
] as const;
export const ledger = [
  ['20 Jul', 'MP-5501', 'Grace Wanjiru', 'Deposit', 0, 15000, 'M-Pesa'],
  ['20 Jul', 'LN-1130', 'Kifaru Logistics', 'Disbursement', 300000, 0, 'Bank'],
  ['19 Jul', 'RP-1401', 'Mary Achieng', 'Loan repayment', 0, 12180, 'M-Pesa'],
  ['19 Jul', 'SH-0447', 'KDU 573T', 'Share top-up', 0, 5000, 'M-Pesa'],
  ['18 Jul', 'WD-0221', 'Peter Otieno', 'Withdrawal', 8000, 0, 'Bank'],
  ['18 Jul', 'INT-Q2', 'All members', 'Interest posting', 0, 6240, 'Accrual'],
] as const;
export const guarantees = [
  ['GP-1130', 'Kifaru Logistics Ltd', 'Mwangaza Chama', 'LN-0455', 100000],
  ['GP-1130', 'Kifaru Logistics Ltd', 'KDU 573T · Matatu', 'LN-0447', 150000],
  ['GP-0912', 'Grace Wanjiru', 'Mary Achieng', 'LN-1401', 30000],
  ['GP-0221', 'Peter Otieno', 'Grace Wanjiru', 'LN-0912', 80000],
] as const;
export const monthly = [['Feb',18.2,12.1],['Mar',19.6,14.8],['Apr',21.1,11.2],['May',22.4,16.9],['Jun',23.8,13.5],['Jul',25.1,18.2]] as const;

export function money(v:number){return <span className="tnum"><span className="gp-kes">KES</span>{Math.round(v).toLocaleString('en-KE')}</span>}
export function avatar(name:string,type?:string){return <span className="gp-avatar">{type==='Person'?name.split(' ').map(x=>x[0]).join('').slice(0,2):type==='Company'?'🏢':type==='Group'?'👥':type==='Vehicle'?'🚐':name.slice(0,2)}</span>}
export function cls(days:number): readonly [string, string]{ if(days<=30)return ['Normal','good']; if(days<=90)return ['Watch','blue']; if(days<=180)return ['Substandard','watch']; if(days<=360)return ['Doubtful','bad']; return ['Loss','bad']; }
export function pill(text:string,tone='neutral'){return <span className={`gp-pill ${tone}`}>{text}</span>}
export function Card({children}:{children:ReactNode}){return <section className="gp-card gp-pad">{children}</section>}
export function DataTable({heads,children}:{heads:string[],children:ReactNode}){return <div className="gp-card gp-table-wrap"><table className="gp-table"><thead><tr>{heads.map(h=><th key={h} className={['DR','CR','Amount','Deposits','Shares','Loan'].includes(h)?'r':''}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
export function LayoutShell({active,children}:{active:string,children:ReactNode}){const flat=nav.flatMap(([,items])=>items); const item=flat.find(i=>i[0]===active);return <div className="gp-app"><aside className="gp-side"><div className="gp-brand"><div className="gp-mark">G</div><div><div className="gp-name">Genesis Prestige</div><div className="gp-tag">ZURI GENESIS · SACCO</div></div></div><nav className="gp-nav">{nav.map(([sec,items])=><div key={sec}><div className="gp-sec">{sec}</div>{items.map(([href,label])=><Link key={href} href={href} className={`gp-nav-item ${href===active?'on':''}`}>{label}{label==='Credit committee'&&<span className="gp-badge">1</span>}</Link>)}</div>)}</nav><div className="gp-who">{avatar('Antony Maina')}<div><div className="nm">Antony Maina</div><div className="rl">Loan officer</div></div></div></aside><div className="gp-main"><header className="gp-head"><div><div className="gp-title">{item?.[2] ?? 'Portfolio overview'}</div><div className="gp-sub">Genesis Prestige Sacco · FY2026</div></div><button className="gp-user" type="button">{avatar('Antony Maina')}Maina</button></header><main className="gp-content">{children}</main></div></div>}
