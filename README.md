# 🎼 Partitura Viva

Aplicativo web (funciona no navegador do celular e do computador) para criar partituras de dois jeitos:

1. **Ouvindo o som** — toque em **🎤 Gravar**, cante ou toque um instrumento perto do celular e as notas vão
   aparecendo na partitura em tempo real. Depois é só corrigir o que precisar.
2. **Escrevendo à mão** — em **✏️ Editar**, escolha a duração e toque nas teclas do piano (ou use o teclado do
   computador). Compassos, barras e ligaduras entre compassos são criados automaticamente.

Também transcreve **músicas do YouTube** (capturando o som da aba no computador) e reconhece **várias notas ao
mesmo tempo** — acordes, melodia principal de uma música completa ou a linha do baixo — com o modelo de IA
[Basic Pitch](https://basicpitch.spotify.com/), que roda dentro do próprio navegador.

Tudo pode ser editado: altura, duração, ponto de aumento, pausas, acidentes (♯/♭), oitava, ligaduras,
acordes, compasso, tonalidade (armadura), clave (Sol, Fá ou pauta dupla de piano), andamento, título e compositor.

## Como usar

| Ação | Como fazer |
| --- | --- |
| Gravar pelo microfone | Aba **🎤 Gravar** → botão vermelho. Toque de novo para parar. |
| Transcrever um áudio gravado | Aba **🎤 Gravar** → *Transcrever arquivo de áudio* (mp3, wav, m4a…) |
| Transcrever do YouTube | Aba **🎤 Gravar** → *Música do YouTube* → cole o link → *Transcrever o som de uma aba* |
| Escolher o que transcrever | *O que transcrever*: melodia (ao vivo), melodia principal, todas as notas/acordes ou baixo (IA) |
| Descobrir o andamento | **👆 Marcar o andamento no ritmo**: toque no botão acompanhando a música |
| Montar acordes | Ligue **+ Acorde** (acima do piano) e toque as teclas para juntar notas à nota atual |
| Inserir nota | Escolha a duração (1, ½, ¼, ⅛, 1/16, 1/32) e toque no piano |
| Inserir pausa | Botão **Pausa** (sem nota selecionada) |
| Corrigir a última nota inserida | ♯, ♭, ▲/▼ (passo na escala), 8ª▲/8ª▼ |
| Selecionar nota | Toque nela na partitura (fica azul) — os botões passam a alterar essa nota |
| Posicionar o cursor | Toque entre duas notas; as próximas notas entram ali |
| Substituir alturas | Botão **Inserir ↔ Substituir**: o piano troca a nota selecionada e avança |
| Ouvir | **▶ Tocar** (começa na nota selecionada, se houver) |
| Desfazer / refazer | ↶ / ↷ |
| Compasso, tonalidade, clave, andamento | Botão ⚙ no topo |
| Salvar / abrir / exportar | Menu ☰: salvar no aparelho, baixar `.json` editável, MusicXML, MIDI, SVG, imprimir/PDF |

**Teclado do computador:** `A`–`G` inserem notas (respeitando a armadura), `1`–`6` duração, `.` ponto,
`0` pausa, `↑`/`↓` sobe/desce na escala, `+`/`-` meio tom, `←`/`→` navega, `Delete` apaga,
`Ctrl+Z`/`Ctrl+Y` desfaz/refaz, `Espaço` toca.

### Dicas para a gravação

- Funciona com **uma nota por vez** (melodia): voz, assobio, flauta, violino, sax, violão tocando nota a nota…
  Acordes não são reconhecidos.
- Ajuste o **andamento (BPM)** antes de gravar para que as figuras rítmicas fiquem corretas. Com o
  **metrônomo** ligado há um compasso de contagem e o tempo fica alinhado às barras de compasso.
- **Precisão rítmica** define a menor figura usada (semicolcheia, colcheia ou semínima). Use uma figura maior
  se a transcrição sair "picada" demais.
- Em ambiente barulhento, diminua a **sensibilidade**.
- O afinador mostra em tempo real a nota ouvida e o desvio em cents.

### Músicas completas e YouTube (IA)

- **Melodia principal**: pega a voz/solo de uma música com acompanhamento (a nota mais aguda em cada momento).
- **Todas as notas, com acordes**: escreve tudo o que for reconhecido, em pauta dupla de piano.
- **Linha do baixo**: só as notas graves.
- A análise acontece **quando você para a gravação** (ou ao escolher o arquivo). No computador leva poucos
  segundos por minuto de música; em celulares mais simples pode demorar mais.
- **YouTube no computador** (Chrome/Edge): ao tocar em *Transcrever o som de uma aba*, escolha esta aba (ou a
  aba do YouTube), marque **Compartilhar áudio da aba** e dê play no vídeo. Toque de novo para parar.
- **YouTube no celular**: os navegadores de celular não permitem capturar o som da aba. Dê play no vídeo com o
  volume alto e grave pelo microfone (botão vermelho).
- O resultado é um **rascunho**: com banda completa (voz, bateria, vários instrumentos) sempre haverá notas para
  corrigir no editor. Separar voz e instrumental antes de transcrever é uma etapa futura.
- Respeite os direitos autorais das músicas que você transcrever.

## Rodando

Não há etapa de build: são arquivos estáticos.

```bash
npm start          # ou: python3 -m http.server 8080
# abra http://localhost:8080
```

Para usar o **microfone no celular** o navegador exige **HTTPS**. A forma mais simples é publicar no
GitHub Pages (Settings → Pages → Deploy from branch) e abrir o endereço `https://…github.io/musica/` no celular.
No Android/iPhone dá para **instalar como aplicativo** (menu do navegador → *Adicionar à tela inicial*); depois
da primeira visita ele funciona sem internet.

## Testes

```bash
npm test
```

Testam a detecção de altura (YIN), a transcrição rítmica de melodias sintetizadas, a divisão em compassos com
ligaduras, a grafia das notas conforme a tonalidade e a exportação MusicXML/MIDI.

## Estrutura

```
index.html          interface
css/style.css       estilos (mobile first)
js/app.js           estado, edição, gravação, menu
js/score.js         modelo da partitura, compassos, tonalidades
js/pitch.js         detecção de altura (YIN) e transcrição rítmica
js/poly.js          transcrição polifônica com IA (Basic Pitch) e quantização de acordes
js/render.js        desenho da partitura com VexFlow
js/audio.js         microfone, metrônomo, reprodução
js/export.js        MusicXML e MIDI
vendor/vexflow.js   VexFlow 4.2.3 (MIT) — desenho da notação musical
vendor/basic-pitch/ Basic Pitch 1.0.1 + TensorFlow.js 3.21 (Apache-2.0) — modelo de IA, carregado sob demanda
sw.js               funcionamento offline (PWA)
```
