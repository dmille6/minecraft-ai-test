import re,os,glob,collections
exp={}
def exports(path):
    if path in exp: return exp[path]
    try: t=open(path).read()
    except OSError: exp[path]=None; return None
    names=set(re.findall(r'^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)',t,re.M))
    for m in re.finditer(r'^export\s*\{([^}]*)\}(\s*from\s*[\'"]([^\'"]+)[\'"])?',t,re.M|re.S):
        for n in ' '.join(re.sub(r'//.*$','',l) for l in m.group(1).split('\n')).split(','):
            n=n.strip()
            if n: names.add(n.split(' as ')[-1].strip())
    if re.search(r'^export\s+default\b',t,re.M): names.add('default')
    star=re.findall(r'^export\s*\*\s*from\s*[\'"]([^\'"]+)[\'"]',t,re.M)
    exp[path]=(names,star); return exp[path]
def has(path,name,depth=0):
    e=exports(path)
    if e is None: return None
    if name in e[0]: return True
    return any(has(os.path.normpath(os.path.join(os.path.dirname(path),s)),name,depth+1) for s in e[1]) if depth<4 else False
bad=[]; nfiles=0; nimports=0
for f in sorted(glob.glob('src/*.mjs')+glob.glob('test/*.mjs')+glob.glob('scripts/*.mjs')):
    t=open(f).read(); nfiles+=1
    for m in re.finditer(r'^import\s*\{([^}]*)\}\s*from\s*[\'"](\.[^\'"]+)[\'"]',t,re.M|re.S):
        tgt=os.path.normpath(os.path.join(os.path.dirname(f),m.group(2)))
        for n in ' '.join(re.sub(r'//.*$','',l) for l in m.group(1).split('\n')).split(','):
            n=n.strip()
            if not n: continue
            nimports+=1
            r=has(tgt,n.split(' as ')[0].strip())
            if r is None: bad.append((f,m.group(2),'MODULE MISSING'))
            elif not r: bad.append((f,m.group(2),n.split(' as ')[0].strip()))
print('files',nfiles,'named imports checked',nimports,'| unresolved',len(bad))
by=collections.defaultdict(list)
for f,mod,n in bad: by[(f,mod)].append(n)
for (f,mod),ns in sorted(by.items())[:60]: print(' ',f,'<-',mod,':',', '.join(sorted(set(ns)))[:170])
