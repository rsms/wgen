---
title: Sample page
---

Showcases some different ways of styling

## Headlines

```
# H1 Title

## H2 Title

### H3 Title

#### H4 Title

##### H5 Title
```

# H1 Title

## H2 Title

### H3 Title

#### H4 Title

##### H5 Title


---

## Text

Paragraph with **bold** and _italic_ as well as a [hyperlink](#top)

Ordered list

1. Item 1
1. Item 2
1. Item 3

Unordered list

- Item 1
- Item 2
- Item 3

Follwing this paragraph is a horizontal ruler, created with

```
---
```

---

## Code

<pre><code>Code can be &#x60;inline&#x60; as well as in syntax-highlighted block form:

&#x60;&#x60;&#x60;ts
interface Typescript&lt;Type extends Coat&gt; {
  readonly coatInfo :Type
}
class Lolcat implements Typescript&lt;Fur&gt; {
  // Transmogrifier 9000
  static readonly meowDecibel = 42.03
  readonly coatInfo :Fur
  constructor(furname :string) {
    this.coatInfo = () =&gt; furname
  }
}
&#x60;&#x60;&#x60;</code></pre>

Code can be `inline` as well as in syntax-highlighted block form:

```ts
interface Typescript<Type extends Coat> {
  readonly coatInfo :Type
}
class Lolcat implements Typescript<Fur> {
  // Transmogrifier 9000
  static readonly meowDecibel = 42.03
  readonly coatInfo :Fur
  constructor(furname :string) {
    this.coatInfo = () => furname
  }
}
```

## Columns

```html
<p class=columns>
  A third of the distance...
</p>
```

<p class=columns>
A third of the distance across the Beach, the meadow ends and sand begins. This slopes gradually up for another third of the distance, to the foot of the sand hills, which seem tumbled into their places by some mighty power, sometimes three tiers of them deep, sometimes two, and sometimes only one. A third of the distance across the Beach, the meadow ends and sand begins.

This slopes gradually up for another third of the distance, <em>to the foot of the sand hills</em>, which seem tumbled into their places by some mighty power, <b>sometimes</b> three tiers of them deep, sometimes two, and sometimes only one.

The outline of this inner shore is most irregular, curving and bending in and out and back upon itself, making coves and points and creeks and channels, and often pushing out in flats with not water enough on them at low tide to wet your ankles.

A third of the distance across the Beach, the meadow ends and sand begins. This slopes gradually up for another third of the distance, to the foot of the sand hills, which seem tumbled into their places by some mighty power, sometimes three tiers of them deep, sometimes two, and sometimes only one.
</p>

## Grids

```html
<grid columns=6>
  <c style="background:lightpink">Column 1</c>
  <c style="background:lightpink">Column 2</c>
  <c style="background:lightpink">Column 3</c>
  <c style="background:lightpink">Column 4</c>
  <c style="background:lightpink">Column 5</c>
  <c style="background:lightpink">Column 6</c>
  <c style="background:lightpink" span=2>Column 1–2</c>
  <c style="background:lightpink" span=2>Column 3–4</c>
  <c style="background:lightpink" span=2>Column 5–6</c>
  <c style="background:lightpink" span=2-5>Column 2–5</c>
</grid>
```

<grid columns=6>
  <c style="background:lightpink">Column 1</c>
  <c style="background:lightpink">Column 2</c>
  <c style="background:lightpink">Column 3</c>
  <c style="background:lightpink">Column 4</c>
  <c style="background:lightpink">Column 5</c>
  <c style="background:lightpink">Column 6</c>
  <c style="background:lightpink" span=2>Column 1–2</c>
  <c style="background:lightpink" span=2>Column 3–4</c>
  <c style="background:lightpink" span=2>Column 5–6</c>
  <c style="background:lightpink" span=2-5>Column 2–5</c>
</grid>


## Miscellaneous

Extra large text

<h1 class=large>&lt;h1 class=large&gt;</h1>
<h1 class=xlarge>&lt;h1 class=xlarge&gt;</h1>
<h1 class=xxlarge>&lt;h1 class=xxlarge&gt;</h1>
<h1 class=xxxlarge>&lt;h1 class=xxxlarge&gt;</h1>
