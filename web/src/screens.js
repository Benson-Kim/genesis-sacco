/**
 * Screen registry for the access-control console. Each entry:
 * { id, label, title, sub, mount(container, ctx) }.
 *
 * `mount` receives the <main> container (already cleared) and a ctx:
 *   { onSessionExpired(): void, modalHost: HTMLElement }
 *
 * Screens land one per commit (incremental push discipline).
 */

/** @type {Array<{id:string,label:string,title:string,sub:string,mount:(container:HTMLElement,ctx:{onSessionExpired:()=>void,modalHost:HTMLElement})=>void}>} */
export const SCREENS = [];
